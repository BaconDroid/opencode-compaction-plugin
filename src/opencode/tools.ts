/**
 * Model-driven tool definitions (the OpenCode SDK boundary). The domain logic
 * they feed lives in `../core/compress.ts` and `../core/expand.ts`.
 */

import { tool } from "@opencode-ai/plugin";
import {
	renderHits,
	renderInspector,
	renderSearch,
	semanticHits,
	type ExpansionSidecar,
} from "../core/expand.js";
import type { VectorIndex } from "../core/adapters.js";
import type { Logger } from "../types.js";

/** Optional semantic retrieval backing for the `search` tool. */
export interface SemanticSearchDeps {
	index: VectorIndex;
	logger: Logger;
}

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
 * Build the `squash` tool definition: merge two or more contiguous compressed
 * blocks (referenced by their `bN` labels) into a single block.
 */
export function buildSquashToolDef() {
	return tool({
		description: `Merge contiguous compressed blocks into a single block.

Use this after several compressions have accumulated to collapse them into one
coherent summary. Reference blocks by their [bN] labels. The blocks must be
adjacent; ambiguous requests are refused.`,
		args: {
			from: tool.schema
				.string()
				.describe("First block label to merge, e.g. 'b0'"),
			to: tool.schema.string().describe("Last block label to merge, e.g. 'b2'"),
			topic: tool.schema
				.string()
				.describe("Short label (3-5 words) for the merged block"),
			summary: tool.schema
				.string()
				.describe("Merged summary replacing the selected blocks"),
		},
		async execute(args) {
			return `Squash queued for blocks ${args.from}-${args.to} (${args.topic}). It will be applied on the next message transform.`;
		},
	});
}

/**
 * Build the `expand` tool: restore a compressed block from the sidecar and keep
 * it expanded on subsequent transforms (sticky).
 */
export function buildExpandToolDef() {
	return tool({
		description: `Expand a compressed block, restoring its original messages.

Reference the block by its [bN] label (or durable id). The expansion is sticky:
the block stays expanded on later turns.`,
		args: {
			block: tool.schema
				.string()
				.describe("Block label (e.g. 'b0') or durable id to expand"),
		},
		async execute(args) {
			return `Expansion queued for block ${args.block}. It will be applied on the next message transform.`;
		},
	});
}

/**
 * Build the `recall` tool: restore a compressed block for a single transform
 * (one-shot).
 */
export function buildRecallToolDef() {
	return tool({
		description: `Recall a compressed block's original messages for the next turn only.

Reference the block by its [bN] label (or durable id). Unlike expand, the
expansion is one-shot and the block re-compresses afterwards.`,
		args: {
			block: tool.schema
				.string()
				.describe("Block label (e.g. 'b0') or durable id to recall"),
		},
		async execute(args) {
			return `Recall queued for block ${args.block}. It will be applied on the next message transform.`;
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

Use this to see which [bN] blocks exist and can be recalled or expanded.`,
		args: {},
		async execute(_args, context) {
			return renderInspector(sidecar, context?.sessionID);
		},
	});
}

/**
 * Build the `search` tool: keyword search over the originals of the compressed
 * blocks. When a semantic `VectorIndex` is supplied it is tried first; any error
 * falls back to the deterministic keyword search (fail-open).
 */
export function buildSearchToolDef(
	sidecar: ExpansionSidecar,
	maxResults: number,
	semantic?: SemanticSearchDeps,
) {
	return tool({
		description: `Search the originals of the compressed blocks.

By default this is a deterministic case-insensitive keyword search. When a
semantic adapter is configured, embedding-based retrieval runs first. Returns
matching [bN] labels and a snippet; use expand or recall to restore a match.`,
		args: {
			query: tool.schema.string().describe("Keyword to search for"),
		},
		async execute(args, context) {
			const sessionID = context?.sessionID;
			if (semantic) {
				try {
					const hits = await semantic.index.search(
						args.query,
						maxResults,
						sessionID,
					);
					const enriched = semanticHits(sidecar, hits, undefined, sessionID);
					if (enriched.length > 0) {
						return renderHits(enriched, args.query, "semantic");
					}
				} catch (error) {
					semantic.logger.warn(
						"semantic search failed; using keyword search",
						{ error: String(error) },
					);
				}
			}
			return renderSearch(sidecar, args.query, maxResults, sessionID);
		},
	});
}
