/**
 * Durable block identifiers and deterministic compression-span selection.
 *
 * The model-driven `compress` tool used to require explicit `{start,end}`
 * message indices, which the model cannot observe reliably (the "problem #10").
 * This module derives stable ids from message metadata and selects the span to
 * compress deterministically: everything after the newest existing compressed
 * block, minus the protected tail.
 */

import { nthUserTurnFromEnd } from "./messages.js";
import type { Message } from "../types.js";

export type Scale = "granular" | "deep";

/** Alias kept for readability — the shared message shape. */
export type BlockMessage = Message;

export interface DeterministicSpan {
	start: number;
	end: number;
}

export interface SelectSpanOptions {
	/** Number of trailing user turns that must never be compressed. */
	protectedTurns?: number;
}

const COMPRESSED_BLOCK_TAG = "<compressed-block";

const COMPRESSED_BLOCK_RE =
	/<compressed-block\b([^>]*)>([\s\S]*?)<\/compressed-block>/g;

export interface CompressBlock {
	/** Index of the message carrying the block. */
	index: number;
	/** Durable id of the block (`id="..."` attribute or derived). */
	id: string;
}

const attrRegexCache = new Map<string, RegExp>();

function readAttr(attrs: string, name: string): string | undefined {
	// Anchor the attribute name so `id` does not match `data-id`; cache the
	// compiled regex (only two attribute names are used).
	let regex = attrRegexCache.get(name);
	if (!regex) {
		regex = new RegExp(`(?:^|\\s)${name}="([^"]*)"`);
		attrRegexCache.set(name, regex);
	}
	return regex.exec(attrs)?.[1];
}

/** Parse every `<compressed-block>` in the message list, in message order. */
export function parseCompressBlocks(messages: BlockMessage[]): CompressBlock[] {
	const blocks: CompressBlock[] = [];
	for (let i = 0; i < messages.length; i++) {
		for (const part of messages[i].parts ?? []) {
			if (part?.type !== "text" || typeof part.text !== "string") continue;
			// A single text part may carry more than one block; scan them all.
			COMPRESSED_BLOCK_RE.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = COMPRESSED_BLOCK_RE.exec(part.text)) !== null) {
				const attrs = match[1] ?? "";
				blocks.push({
					index: i,
					id: readAttr(attrs, "id") ?? blockId(messages[i]),
				});
			}
		}
	}
	return blocks;
}

/** Render the body of a compressed block: `[bN]` followed by the summary. */
export function renderBlockBody(label: string, summary: string): string {
	return `[${label}]\n\n${summary}`;
}

/** True when a message carries a `<compressed-block>` payload. */
export function isCompressedBlockMessage(message: BlockMessage): boolean {
	return (message.parts ?? []).some(
		(part) =>
			part?.type === "text" &&
			typeof part.text === "string" &&
			part.text.includes(COMPRESSED_BLOCK_TAG),
	);
}

/**
 * Durable id for a message: `r:<callID>` for tool calls, `u:<timestamp>` for
 * user turns, `a:<messageId>` otherwise.
 */
export function blockId(message: BlockMessage): string {
	const info = message.info ?? ({} as BlockMessage["info"]);
	const part = message.parts?.[0];
	if (part?.type === "tool" && typeof part.callID === "string" && part.callID) {
		return `r:${part.callID}`;
	}
	const timestamp = info.time?.created ?? info.timestamp;
	if (info.role === "user" && typeof timestamp === "number") {
		return `u:${timestamp}`;
	}
	if (typeof info.id === "string" && info.id) {
		return `a:${info.id}`;
	}
	if (typeof timestamp === "number") {
		return `u:${timestamp}`;
	}
	return "m:0";
}

/**
 * Index of the earliest message in the protected tail: the Nth user turn from
 * the end (and everything after it). Returns `messages.length` when no tail is
 * protected and `0` when there are fewer user turns than `protectedTurns`.
 */
function protectedTailStart(
	messages: BlockMessage[],
	protectedTurns: number,
): number {
	if (protectedTurns <= 0) return messages.length;
	return nthUserTurnFromEnd(messages, protectedTurns) ?? 0;
}

/**
 * Select the deterministic span to compress: messages after the newest
 * existing compressed block, excluding the protected tail. Returns `undefined`
 * when there is nothing safe to compress.
 */
export function selectDeterministicSpan(
	messages: BlockMessage[],
	opts: SelectSpanOptions = {},
): DeterministicSpan | undefined {
	const protectedTurns = opts.protectedTurns ?? 3;
	const tailStart = protectedTailStart(messages, protectedTurns);

	// Only blocks before the protected tail anchor the span: a block inside the
	// tail must not shadow the compressible messages before it.
	let newestBlockIndex = -1;
	for (let i = 0; i < tailStart; i++) {
		if (isCompressedBlockMessage(messages[i])) newestBlockIndex = i;
	}

	const eligible: number[] = [];
	for (let i = newestBlockIndex + 1; i < tailStart; i++) eligible.push(i);

	if (eligible.length === 0) return undefined;
	return { start: eligible[0], end: eligible[eligible.length - 1] };
}
