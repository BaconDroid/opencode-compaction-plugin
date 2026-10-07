/**
 * Compress tool for opencode-live-compaction.
 *
 * Exposes a "compress" tool to the model that replaces a range of messages
 * with a summary written by the model itself. The model has full context,
 * so it can write high-quality summaries. The plugin handles the mechanical
 * replacement in the messages array.
 *
 * Flow:
 *   1. Model calls compress({ topic, start, end, summary })
 *   2. Tool stores the pending compression request
 *   3. On next message transform, the range is replaced with a synthetic
 *      summary message
 */

import type { Message } from "../types.js";
import { KeyedQueue } from "./store.js";
import {
	blockId,
	collectExistingBlockIds,
	orderCompressBlocks,
	parseCompressBlocks,
	renderBlockBody,
	selectDeterministicSpan,
	type Scale,
} from "./blocks.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressRequest {
	/** Topic label for the compression (3-5 words) */
	topic: string;
	/** Start message index (inclusive, 0-based). Legacy: omit to auto-select. */
	start?: number;
	/** End message index (inclusive, 0-based). Legacy: omit to auto-select. */
	end?: number;
	/** Summary text written by the model */
	summary: string;
	/** Compression scale: one message (granular) or a range (deep) */
	scale?: Scale;
	/** Timestamp for ordering */
	timestamp: number;
	/** callID of the compress tool call that produced this request */
	callID?: string;
}

// ---------------------------------------------------------------------------
// Pending compressions storage (per instance, per session)
// ---------------------------------------------------------------------------

/**
 * Per-plugin-instance store of pending compression requests. Kept as a class so
 * state is not shared between plugin instances in the same process.
 */
export class CompressionStore extends KeyedQueue<CompressRequest> {
	/** Get and clear pending compressions for a session (newest range first). */
	override drain(sessionID: string): CompressRequest[] {
		// Explicit-index requests are processed from end to start; auto-selected
		// requests (no index) go last since they recompute their span.
		return this.take(sessionID).sort(
			(a, b) => (b.start ?? -1) - (a.start ?? -1),
		);
	}
}

// ---------------------------------------------------------------------------
// Compression application
// ---------------------------------------------------------------------------

/**
 * Split compression requests into those that belong to the given message array
 * and those that must be deferred.
 *
 * A request is applicable when its originating `callID` appears in the messages
 * (i.e. the compress tool call is part of this conversation). Requests without a
 * `callID` are treated as applicable for backward compatibility. This prevents a
 * compression queued for one session from being applied to another session's
 * messages by index.
 */
export function selectCompressions(
	messages: Message[],
	requests: CompressRequest[],
): { applicable: CompressRequest[]; deferred: CompressRequest[] } {
	const present = new Set<string>();
	for (const msg of messages) {
		for (const part of msg.parts ?? []) {
			if (typeof part.callID === "string") present.add(part.callID);
		}
	}

	const applicable: CompressRequest[] = [];
	const deferred: CompressRequest[] = [];

	for (const req of requests) {
		if (!req.callID || present.has(req.callID)) {
			applicable.push(req);
		} else {
			deferred.push(req);
		}
	}

	return { applicable, deferred };
}

export interface ApplyCompressionOptions {
	/** Trailing user turns protected from deterministic span selection. */
	protectedTurns?: number;
	/** Called before a range is replaced, with the original messages. */
	record?: (info: {
		id: string;
		label: string;
		topic: string;
		original: Message[];
	}) => void;
}

/**
 * Apply pending compressions to a messages array.
 *
 * Requests with explicit `{start,end}` are processed from end to start to keep
 * indices stable. Requests without indices select their span deterministically
 * (after the newest existing block, excluding the protected tail).
 *
 * Returns the number of messages replaced.
 */
export function applyCompressions(
	messages: Message[],
	requests: CompressRequest[],
	opts: ApplyCompressionOptions = {},
): number {
	if (requests.length === 0) return 0;

	let totalReplaced = 0;

	const hasIndex = (req: CompressRequest): boolean =>
		typeof req.start === "number" && typeof req.end === "number";

	const explicit = requests
		.filter(hasIndex)
		.sort((a, b) => (b.start as number) - (a.start as number));
	const auto = requests.filter((req) => !hasIndex(req));

	for (const req of [...explicit, ...auto]) {
		let start: number;
		let end: number;

		if (hasIndex(req)) {
			start = Math.max(0, req.start as number);
			end = Math.min(messages.length - 1, req.end as number);
		} else {
			const span = selectDeterministicSpan(messages, {
				protectedTurns: opts.protectedTurns ?? 3,
			});
			if (!span) continue;
			start = span.start;
			end = span.end;
		}

		if (start > end || start >= messages.length) continue;

		// Count how many messages we're replacing
		const count = end - start + 1;

		// Choose a role that does not collide with the preceding message, so the
		// synthetic block does not create two consecutive same-role messages.
		const prevRole = messages[start - 1]?.info?.role;
		const role = prevRole === "user" ? "assistant" : "user";

		// Assign a durable id and a stable label based on existing blocks.
		const id = blockId(messages[start]);
		const existingCount = collectExistingBlockIds(messages).size;
		const label = `b${existingCount}`;

		// Capture the originals before they are replaced (for expand).
		if (opts.record) {
			opts.record({
				id,
				label,
				topic: req.topic,
				original: messages.slice(start, end + 1),
			});
		}

		// Create a synthetic summary message
		const scaleAttr = req.scale ? ` scale="${escapeAttr(req.scale)}"` : "";
		const summaryMessage: Message = {
			info: { role },
			parts: [
				{
					type: "text",
					text: `<compressed-block id="${escapeAttr(id)}" label="${label}" topic="${escapeAttr(req.topic)}" range="${start}-${end}" count="${count}"${scaleAttr}>\n${renderBlockBody(label, req.summary)}\n</compressed-block>`,
				},
			],
		};

		// Replace the range with the summary
		messages.splice(start, count, summaryMessage);
		totalReplaced += count;
	}

	return totalReplaced;
}

// ---------------------------------------------------------------------------
// Squash: merge contiguous compressed blocks into one
// ---------------------------------------------------------------------------

export interface SquashRequest {
	/** First block label (`bN`) to merge. */
	from: string;
	/** Last block label (`bN`) to merge. */
	to: string;
	summary: string;
	topic: string;
	timestamp: number;
	callID?: string;
}

/** Per-plugin-instance store of pending squash requests, keyed by session. */
export class SquashStore extends KeyedQueue<SquashRequest> {}

export interface ApplySquashOptions {
	/** Maximum number of blocks merged by a single squash (default: 8). */
	maxBlocks?: number;
}

/**
 * Merge contiguous compressed blocks into a single block.
 *
 * Fail-closed: refuses requests that reference unknown labels, fewer than two
 * blocks, more than `maxBlocks`, or blocks that are not contiguous messages.
 * Returns the number of blocks merged.
 */
export function applySquash(
	messages: Message[],
	requests: SquashRequest[],
	opts: ApplySquashOptions = {},
): number {
	const maxBlocks = opts.maxBlocks ?? 8;
	let merged = 0;

	for (const req of requests) {
		const blocks = orderCompressBlocks(parseCompressBlocks(messages));
		const fromIndex = blocks.findIndex((b) => b.label === req.from);
		const toIndex = blocks.findIndex((b) => b.label === req.to);
		if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) continue;

		const selected = blocks.slice(fromIndex, toIndex + 1);
		if (selected.length < 2 || selected.length > maxBlocks) continue;

		// Require the selected blocks to occupy adjacent messages.
		const contiguous = selected.every(
			(block, i) => i === 0 || block.index === selected[i - 1].index + 1,
		);
		if (!contiguous) continue;

		const firstIndex = selected[0].index;
		const lastIndex = selected[selected.length - 1].index;
		const prevRole = messages[firstIndex - 1]?.info?.role;
		const role = prevRole === "user" ? "assistant" : "user";
		const label = selected[0].label as string;
		const id = selected[0].id;

		const summaryMessage: Message = {
			info: { role },
			parts: [
				{
					type: "text",
					text: `<compressed-block id="${escapeAttr(id)}" label="${label}" topic="${escapeAttr(req.topic)}" range="${firstIndex}-${lastIndex}" count="${selected.length}" squashed="true">\n${renderBlockBody(label, req.summary)}\n</compressed-block>`,
				},
			],
		};

		messages.splice(firstIndex, lastIndex - firstIndex + 1, summaryMessage);
		merged += selected.length;
	}

	return merged;
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

