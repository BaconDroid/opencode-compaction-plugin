/**
 * Extract the previous compaction summary from a session's messages.
 *
 * OpenCode marks a compaction result as an assistant message with
 * `info.summary === true`. When the plugin replaces the default compaction
 * prompt, it must carry that summary forward itself to keep continuity across
 * repeated compactions.
 */

interface SummaryMessageLike {
	info?: { role?: string; summary?: boolean };
	parts?: Array<{ type?: string; text?: string }>;
}

/** Return the text of the most recent compaction summary, if any. */
export function extractPreviousSummary(messages: unknown): string | undefined {
	if (!Array.isArray(messages)) return undefined;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as SummaryMessageLike | undefined;
		if (msg?.info?.role !== "assistant" || msg.info.summary !== true) continue;

		const text = (msg.parts ?? [])
			.filter((p) => p?.type === "text" && typeof p.text === "string")
			.map((p) => p.text as string)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}
