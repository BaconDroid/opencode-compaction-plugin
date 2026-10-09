/**
 * Model-driven tool definitions (the OpenCode SDK boundary). The domain logic
 * lives in `../core/compress.ts`.
 */

import { tool } from "@opencode-ai/plugin";

/**
 * Build the `compress` tool definition: replace a range of messages with a
 * model-written summary (the plugin selects the range when indices are omitted).
 */
export function buildCompressToolDef() {
	return tool({
		description: `Compress a range of conversation messages into a summary.

Use this tool when you have completed a task phase and want to reduce context size.
You write the summary — you have the full context. Be thorough but concise.

When to compact:
- After a phase is finished and verified (tests passing, task done), not mid-edit.
- When the context is growing with completed, self-contained work you no longer need verbatim.
- Not when the context is small or the recent turns are still being actively worked on.

The compressed range will be replaced with your summary in the conversation.
Message indices are 0-based. Use the message order visible in the conversation.`,
		args: {
			topic: tool.schema
				.string()
				.describe("Short label (3-5 words) for display, e.g., 'Auth Bug Fix'"),
			summary: tool.schema
				.string()
				.describe(
					"Complete technical summary replacing all messages in the range. Include file paths, decisions, error strings, and code snippets that are still relevant.",
				),
			scale: tool.schema
				.enum(["granular", "deep"])
				.optional()
				.describe(
					"Descriptive label for the block; does not change the selected range",
				),
			start: tool.schema
				.number()
				.int()
				.optional()
				.describe(
					"Legacy start message index (inclusive, 0-based). Omit to auto-select the range.",
				),
			end: tool.schema
				.number()
				.int()
				.optional()
				.describe(
					"Legacy end message index (inclusive, 0-based). Omit to auto-select the range.",
				),
		},
		async execute(args) {
			const range =
				typeof args.start === "number" && typeof args.end === "number"
					? `messages ${args.start}-${args.end}`
					: "an auto-selected range";
			return `Compression queued for ${range} (${args.topic}). It will be applied on the next message transform.`;
		},
	});
}
