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

/** Distinct non-empty text parts, oldest first, bounded by `maxSamples`. */
function collectTexts(messages: BlockMessage[], maxSamples: number): string[] {
	const seen = new Set<string>();
	const texts: string[] = [];
	for (const message of messages) {
		for (const part of message.parts ?? []) {
			const text = (part as { text?: unknown }).text;
			if (typeof text !== "string" || text.length === 0) continue;
			if (seen.has(text)) continue;
			seen.add(text);
			texts.push(text);
			if (texts.length >= maxSamples) return texts;
		}
	}
	return texts;
}

/**
 * Build a synchronous token estimator calibrated by the scorer. Each distinct
 * text is scored once; unresolved texts and tool outputs keep the heuristic.
 * Falls back to `estimateTokens` when there is nothing to score or every score
 * is unusable.
 */
export async function buildScorerEstimator(
	scorer: Scorer,
	messages: BlockMessage[],
	maxSamples = DEFAULT_SCORER_MAX_SAMPLES,
): Promise<(messages: BlockMessage[]) => number> {
	const texts = collectTexts(messages, maxSamples);
	if (texts.length === 0) return estimateTokens;

	const values = await Promise.all(texts.map((text) => scorer.score(text)));
	const scores = new Map<string, number>();
	texts.forEach((text, index) => {
		const value = values[index];
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
			scores.set(text, value);
		}
	});
	if (scores.size === 0) return estimateTokens;

	return (msgs) => estimateTokens(msgs, (text) => scores.get(text));
}
