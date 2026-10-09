/**
 * The model-driven `compress` domain: a queued request replaces a range of
 * messages with a model-written summary on the next message transform.
 */

import type { Message } from "../types.js";
import { KeyedQueue } from "./store.js";
import {
	blockId,
	parseCompressBlocks,
	renderBlockBody,
	selectDeterministicSpan,
	type Scale,
} from "./blocks.js";

// Types

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

// Pending compressions storage (per instance, per session)

/**
 * Per-plugin-instance store of pending compression requests. Kept as a class so
 * state is not shared between plugin instances in the same process.
 */
export class CompressionStore extends KeyedQueue<CompressRequest> {
	/** Get and clear pending compressions for a session (newest range first). */
	drain(sessionID: string): CompressRequest[] {
		// Explicit-index requests are processed from end to start; auto-selected
		// requests (no index) go last since they recompute their span.
		return this.take(sessionID).sort(
			(a, b) => (b.start ?? -1) - (a.start ?? -1),
		);
	}
}

// Compression application

/** All tool callIDs present in the messages. */
function presentCallIds(messages: Message[]): Set<string> {
	const present = new Set<string>();
	for (const msg of messages) {
		for (const part of msg.parts ?? []) {
			if (typeof part.callID === "string") present.add(part.callID);
		}
	}
	return present;
}

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
	const present = presentCallIds(messages);

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

	// Counting parsed blocks (not distinct ids) keeps labels unique even if two
	// blocks share an id. Each applied request inserts exactly one block.
	let blockCount = parseCompressBlocks(messages).length;

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

		const count = end - start + 1;

		// Choose a role that does not collide with the preceding message, so the
		// synthetic block does not create two consecutive same-role messages.
		const prevRole = messages[start - 1]?.info?.role;
		const role = prevRole === "user" ? "assistant" : "user";

		const id = blockId(messages[start]);
		const label = `b${blockCount}`;

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

		messages.splice(start, count, summaryMessage);
		blockCount++;
		totalReplaced += count;
	}

	return totalReplaced;
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

