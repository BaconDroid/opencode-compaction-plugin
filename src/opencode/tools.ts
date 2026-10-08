/**
 * Model-driven tool definitions (the OpenCode SDK boundary). The domain logic
 * they feed lives in `../core/compress.ts` and `../core/expand.ts`.
 */

import { tool } from "@opencode-ai/plugin";
import { renderInspector, type ExpansionSidecar } from "../core/expand.js";

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

/**
 * Build the `expand` tool: restore a compressed block from the sidecar. The
 * `mode` argument selects a sticky expansion (kept on later transforms) or a
 * one-shot restore (the block re-compresses afterwards).
 */
export function buildExpandToolDef() {
	return tool({
		description: `Expand a compressed block, restoring its original messages.

Reference the block by its [bN] label (or durable id). Set \`mode\` to "sticky"
(default) to keep the block expanded on later turns, or "once" to restore it for
the next transform only (the block re-compresses afterwards).`,
		args: {
			block: tool.schema
				.string()
				.describe("Block label (e.g. 'b0') or durable id to expand"),
			mode: tool.schema
				.enum(["sticky", "once"])
				.optional()
				.describe("Expansion mode (default: sticky)"),
		},
		async execute(args) {
			return `Expansion queued for block ${args.block} (${args.mode ?? "sticky"}). It will be applied on the next message transform.`;
		},
	});
}

/**
 * Build the `inspect` tool: list the compressed blocks currently held in the
 * in-memory sidecar.
 */
export function buildInspectToolDef(sidecar: ExpansionSidecar) {
	return tool({
		description: `List the compressed blocks currently held in memory.

Use this to see which [bN] blocks exist and can be expanded.`,
		args: {},
		async execute(_args, context) {
			return renderInspector(sidecar, context?.sessionID);
		},
	});
}
