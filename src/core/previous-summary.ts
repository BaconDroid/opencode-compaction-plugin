/**
 * Extract the previous compaction summary from a session's messages.
 *
 * OpenCode marks a compaction result as an assistant message with
 * `info.summary === true`. When the plugin replaces the default compaction
 * prompt, it must carry that summary forward itself to keep continuity across
 * repeated compactions.
 *
 * A small sliding state avoids re-emitting the same summary and provides a
 * fallback when the newest messages no longer contain the summary (for example
 * right after a compaction replaced the history).
 */

import { partsText } from "./messages.js";

interface SummaryMessageLike {
	info?: { role?: string; summary?: boolean; id?: string };
	parts?: Array<{ type?: string; text?: string }>;
}

export interface SlidingState {
	/** Only consider summaries strictly after this message index (inclusive cutoff). */
	cutoffIndex?: number;
	/** id of the summary message carried forward last time. */
	lastSummaryMessageId?: string;
	/** Text of the summary carried forward last time (fallback). */
	lastSummaryText?: string;
}

function summaryText(msg: SummaryMessageLike): string | undefined {
	return partsText(msg.parts) || undefined;
}

/** Return the text of the most recent compaction summary, if any. */
export function extractPreviousSummary(
	messages: unknown,
	state?: SlidingState,
): string | undefined {
	if (!Array.isArray(messages)) return undefined;

	for (let i = messages.length - 1; i >= 0; i--) {
		if (state?.cutoffIndex !== undefined && i <= state.cutoffIndex) break;

		const msg = messages[i] as SummaryMessageLike | undefined;
		if (msg?.info?.role !== "assistant" || msg.info.summary !== true) continue;

		// The summary already carried forward is not re-emitted; a newer summary
		// supersedes it, otherwise the fallback below keeps continuity.
		if (state?.lastSummaryMessageId && msg.info.id === state.lastSummaryMessageId) {
			continue;
		}

		const text = summaryText(msg);
		if (!text) continue;

		if (state) {
			state.lastSummaryMessageId = msg.info.id;
			state.lastSummaryText = text;
		}
		return text;
	}

	return state?.lastSummaryText;
}
