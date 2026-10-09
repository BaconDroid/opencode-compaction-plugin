/**
 * Optional residual/perplexity scorer orchestration (E5/E9).
 *
 * The eviction budget is normally estimated by the heuristic `estimateTokens`
 * (chars ÷ 4). When a `Scorer` is configured, each distinct text part is scored
 * once (up to `maxSamples`) and its residual estimate replaces the heuristic for
 * that text; tool outputs/inputs and unscored texts keep the heuristic. The
 * result is a synchronous estimator usable by the (sync) eviction pass.
 *
 * Fail-open: callers catch errors and keep the heuristic estimator.
 */

import type { BlockMessage } from "./blocks.js";
import { estimateTokens } from "./eviction.js";
import type { Scorer } from "./adapters.js";

export const DEFAULT_SCORER_MAX_SAMPLES = 200;
/** Maximum in-flight scorer requests, to avoid hammering the endpoint. */
export const SCORER_CONCURRENCY = 8;
/**
 * Fraction of the eviction budget below which the scorer is skipped. Far below
 * the budget eviction will not run, so scoring would be wasted work (and, for a
 * model-backed scorer, a wasted round-trip).
 */
export const SCORER_BUDGET_GATE = 0.5;

/**
 * Score every text, in input order. A scorer that exposes `scoreMany` is used
 * in one batch; otherwise requests are issued with at most `limit` in flight.
 * Rejects with the first error (the caller falls back to the heuristic).
 */
async function scoreAll(
	scorer: Scorer,
	texts: string[],
	limit: number,
): Promise<number[]> {
	if (typeof scorer.scoreMany === "function") {
		const values = await scorer.scoreMany(texts);
		if (values.length !== texts.length) {
			throw new Error(
				`scorer returned ${values.length} scores for ${texts.length} texts`,
			);
		}
		return values;
	}
	const results: number[] = new Array(texts.length);
	let next = 0;
	let failure: unknown;
	const worker = async (): Promise<void> => {
		while (failure === undefined) {
			const index = next++;
			if (index >= texts.length) return;
			try {
				results[index] = await scorer.score(texts[index]);
			} catch (error) {
				failure = error;
				return;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, texts.length) }, worker),
	);
	if (failure !== undefined) throw failure;
	return results;
}

/** Distinct non-empty text parts, oldest first, bounded by `maxSamples`. */
function collectTexts(messages: BlockMessage[], maxSamples: number): string[] {
	const seen = new Set<string>();
	const texts: string[] = [];
	for (const message of messages) {
		for (const part of message.parts ?? []) {
			const text = (part as { text?: unknown }).text;
			if (typeof text !== "string" || text.trim().length === 0) continue;
			if (seen.has(text)) continue;
			seen.add(text);
			texts.push(text);
			if (texts.length >= maxSamples) return texts;
		}
	}
	return texts;
}

/** Cross-transform score cache, one per scorer instance (bounded). */
const scoreCache = new WeakMap<Scorer, Map<string, number>>();
const MAX_SCORE_CACHE = 1000;

/**
 * A synchronous estimator plus the per-text resolver it uses. The resolver lets
 * the eviction pass maintain an exact running budget without re-scanning.
 */
export type ScorerEstimator = ((
	messages: BlockMessage[],
) => number) & {
	resolveText: (text: string) => number | undefined;
};

/** Estimator that scores nothing (unresolved texts keep the heuristic). */
function heuristicEstimator(): ScorerEstimator {
	return Object.assign(
		(messages: BlockMessage[]) => estimateTokens(messages),
		{ resolveText: (_text: string) => undefined },
	);
}

/**
 * Build a synchronous token estimator calibrated by the scorer. Each distinct
 * text is scored once and the result is cached across transforms; unresolved
 * texts and tool outputs keep the heuristic. Falls back to `estimateTokens`
 * when there is nothing to score or every score is unusable.
 */
export async function buildScorerEstimator(
	scorer: Scorer,
	messages: BlockMessage[],
	maxSamples = DEFAULT_SCORER_MAX_SAMPLES,
): Promise<ScorerEstimator> {
	const texts = collectTexts(messages, maxSamples);
	if (texts.length === 0) return heuristicEstimator();

	let cache = scoreCache.get(scorer);
	if (!cache) {
		cache = new Map();
		scoreCache.set(scorer, cache);
	}
	const store = cache;

	const missing = texts.filter((text) => !store.has(text));
	if (missing.length > 0) {
		const values = await scoreAll(scorer, missing, SCORER_CONCURRENCY);
		missing.forEach((text, index) => {
			const value = values[index];
			if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
				store.set(text, value);
			}
		});
	}

	// Snapshot the scored texts once, so the resolver stays consistent for the
	// whole transform even as the cache is bounded below.
	const scores = new Map<string, number>();
	for (const text of texts) {
		const value = store.get(text);
		if (value !== undefined) scores.set(text, value);
	}

	// Bound the cache, dropping the oldest inserted texts.
	while (store.size > MAX_SCORE_CACHE) {
		const oldest = store.keys().next().value;
		if (oldest === undefined) break;
		store.delete(oldest);
	}

	if (scores.size === 0) return heuristicEstimator();

	const resolveText = (text: string): number | undefined => scores.get(text);
	return Object.assign(
		(msgs: BlockMessage[]) => estimateTokens(msgs, resolveText),
		{ resolveText },
	);
}
