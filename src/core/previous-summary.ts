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

import { lastMessageWhere, partsText } from "./messages.js";

export interface SlidingState {
	/** Only consider summaries strictly after this message index (inclusive cutoff). */
	cutoffIndex?: number;
	/** id of the summary message carried forward last time. */
	lastSummaryMessageId?: string;
	/** Text of the summary carried forward last time (fallback). */
	lastSummaryText?: string;
}

/** Return the text of the most recent compaction summary, if any. */
export function extractPreviousSummary(
	messages: unknown,
	state?: SlidingState,
): string | undefined {
	const found = lastMessageWhere(messages, (message, index) => {
		if (state?.cutoffIndex !== undefined && index <= state.cutoffIndex) {
			return false;
		}
		if (message.info?.role !== "assistant" || message.info.summary !== true) {
			return false;
		}
		// The summary already carried forward is not re-emitted; a newer summary
		// supersedes it, otherwise the fallback below keeps continuity.
		if (
			state?.lastSummaryMessageId &&
			message.info.id === state.lastSummaryMessageId
		) {
			return false;
		}
		return partsText(message.parts) !== "";
	});

	if (!found) return state?.lastSummaryText;

	const text = partsText(found.message.parts);
	if (state) {
		state.lastSummaryMessageId = found.message.info?.id;
		state.lastSummaryText = text;
	}
	return text;
}
