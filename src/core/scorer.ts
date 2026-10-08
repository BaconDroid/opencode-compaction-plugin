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
 * Score every text with at most `limit` requests in flight. Resolves in input
 * order; rejects with the first error once the in-flight requests settle.
 */
async function scoreAll(
	scorer: Scorer,
	texts: string[],
	limit: number,
): Promise<number[]> {
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
 * Build a synchronous token estimator calibrated by the scorer. Each distinct
 * text is scored once and the result is cached across transforms; unresolved
 * texts and tool outputs keep the heuristic. Falls back to `estimateTokens`
 * when there is nothing to score or every score is unusable.
 */
export async function buildScorerEstimator(
	scorer: Scorer,
	messages: BlockMessage[],
	maxSamples = DEFAULT_SCORER_MAX_SAMPLES,
): Promise<(messages: BlockMessage[]) => number> {
	const texts = collectTexts(messages, maxSamples);
	if (texts.length === 0) return estimateTokens;

	let cache = scoreCache.get(scorer);
	if (!cache) {
		cache = new Map();
		scoreCache.set(scorer, cache);
	}

	const missing = texts.filter((text) => !cache.has(text));
	if (missing.length > 0) {
		const values = await scoreAll(scorer, missing, SCORER_CONCURRENCY);
		missing.forEach((text, index) => {
			const value = values[index];
			if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
				cache!.set(text, value);
			}
		});
	}

	// Build `scores` before trimming: trimming first could evict a text that is
	// in the current set, silently dropping it to the heuristic.
	const scores = new Map<string, number>();
	for (const text of texts) {
		const value = cache.get(text);
		if (value !== undefined) scores.set(text, value);
	}

	// Bound the cache, dropping the oldest inserted texts.
	while (cache.size > MAX_SCORE_CACHE) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}

	if (scores.size === 0) return estimateTokens;

	return (msgs) => estimateTokens(msgs, (text) => scores.get(text));
}
