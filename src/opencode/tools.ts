/**
 * Model-driven tool definitions (the OpenCode SDK boundary). The domain logic
 * lives in `../core/compress.ts`.
 *
 * OpenCode 2 registers tools through `ctx.tool.transform`, with a JSON Schema
 * `input` and an executor that returns tool content. This module builds the
 * definition; `index.ts` wraps the returned string as `{ content }`.
 */

/** Arguments accepted by the `compress` tool. */
export interface CompressToolArgs {
	topic: string;
	summary: string;
	scale?: "granular" | "deep";
	/** Legacy start message index (inclusive, 0-based). Omit to auto-select. */
	start?: number;
	/** Legacy end message index (inclusive, 0-based). Omit to auto-select. */
	end?: number;
}

/**
 * Build the `compress` tool definition: replace a range of messages with a
 * model-written summary (the plugin selects the range when indices are omitted).
 */
export function buildCompressToolDef() {
	return {
		name: "compress",
		description: `Compress a range of conversation messages into a summary.

Use this tool when you have completed a task phase and want to reduce context size.
You write the summary - you have the full context. Be thorough but concise.

When to compact:
- After a phase is finished and verified (tests passing, task done), not mid-edit.
- When the context is growing with completed, self-contained work you no longer need verbatim.
- Not when the context is small or the recent turns are still being actively worked on.

The compressed range will be replaced with your summary in the conversation.
Message indices are 0-based. Use the message order visible in the conversation.`,
		input: {
			type: "object",
			properties: {
				topic: {
					type: "string",
					description: "Short label (3-5 words) for display, e.g., 'Auth Bug Fix'",
				},
				summary: {
					type: "string",
					description:
						"Complete technical summary replacing all messages in the range. Include file paths, decisions, error strings, and code snippets that are still relevant.",
				},
				scale: {
					type: "string",
					enum: ["granular", "deep"],
					description:
						"Descriptive label for the block; does not change the selected range",
				},
				start: {
					type: "integer",
					description:
						"Legacy start message index (inclusive, 0-based). Omit to auto-select the range.",
				},
				end: {
					type: "integer",
					description:
						"Legacy end message index (inclusive, 0-based). Omit to auto-select the range.",
				},
			},
			required: ["topic", "summary"],
			additionalProperties: false,
		} as const,
		async execute(args: CompressToolArgs): Promise<string> {
			const range =
				typeof args.start === "number" && typeof args.end === "number"
					? `messages ${args.start}-${args.end}`
					: "an auto-selected range";
			return `Compression queued for ${range} (${args.topic}). It will be applied on the next message transform.`;
		},
	};
}

/** The registered tool definition. */
export type CompressToolDef = ReturnType<typeof buildCompressToolDef>;
