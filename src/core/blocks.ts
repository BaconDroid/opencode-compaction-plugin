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
	/** Ids already known to be compressed blocks. */
	existingBlockIds?: Set<string>;
	/** Number of trailing user turns that must never be compressed. */
	protectedTurns?: number;
}

const COMPRESSED_BLOCK_TAG = "<compressed-block";

const COMPRESSED_BLOCK_RE =
	/<compressed-block\b([^>]*)>([\s\S]*?)<\/compressed-block>/;

export interface CompressBlock {
	/** Index of the message carrying the block. */
	index: number;
	/** Durable id of the block (`id="..."` attribute or derived). */
	id: string;
	topic?: string;
	summary: string;
	/** Stable `bN` label assigned by {@link orderCompressBlocks}. */
	label?: string;
}

function readAttr(attrs: string, name: string): string | undefined {
	const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
	return match?.[1];
}

/** Parse every `<compressed-block>` in the message list, in message order. */
export function parseCompressBlocks(messages: BlockMessage[]): CompressBlock[] {
	const blocks: CompressBlock[] = [];
	for (let i = 0; i < messages.length; i++) {
		for (const part of messages[i].parts ?? []) {
			if (part?.type !== "text" || typeof part.text !== "string") continue;
			const match = COMPRESSED_BLOCK_RE.exec(part.text);
			if (!match) continue;
			const attrs = match[1] ?? "";
			// Strip a leading `[bN]` label so re-rendering stays stable.
			const summary = (match[2] ?? "")
				.replace(/^\s*\[b\d+\]\s*/, "")
				.trim();
			blocks.push({
				index: i,
				id: readAttr(attrs, "id") ?? blockId(messages[i]),
				topic: readAttr(attrs, "topic"),
				summary,
			});
		}
	}
	return blocks;
}

/**
 * Sort blocks by anchor index and renumber them `b0`, `b1`, ... Labels are
 * stable as long as new blocks are appended after existing ones.
 */
export function orderCompressBlocks(blocks: CompressBlock[]): CompressBlock[] {
	return [...blocks]
		.sort((a, b) => a.index - b.index)
		.map((block, i) => ({ ...block, label: `b${i}` }));
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

/** Ids of every `<compressed-block>` in the list. */
export function collectExistingBlockIds(messages: BlockMessage[]): Set<string> {
	return new Set(parseCompressBlocks(messages).map((block) => block.id));
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
	const existingBlockIds = opts.existingBlockIds;

	let newestBlockIndex = -1;
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		const isBlock =
			isCompressedBlockMessage(message) ||
			existingBlockIds?.has(blockId(message)) === true;
		if (isBlock) newestBlockIndex = i;
	}

	const tailStart = protectedTailStart(messages, protectedTurns);

	const eligible: number[] = [];
	for (let i = newestBlockIndex + 1; i < messages.length && i < tailStart; i++) {
		const message = messages[i];
		if (isCompressedBlockMessage(message)) continue;
		if (existingBlockIds?.has(blockId(message))) continue;
		eligible.push(i);
	}

	if (eligible.length === 0) return undefined;
	return { start: eligible[0], end: eligible[eligible.length - 1] };
}
