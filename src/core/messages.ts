/**
 * Pure helpers to read text, tool input and user turns from messages.
 *
 * No imports beyond the shared types, so this module can be used by the
 * lower-level modules (blocks, trim, strategies, …) without pulling in config.
 */

import type { Message, MessagePart } from "../types.js";

/** Concatenate the text parts of a message, trimmed. */
export function partsText(parts: unknown): string {
	if (!Array.isArray(parts)) return "";
	return parts
		.filter(
			(part): part is MessagePart =>
				!!part && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text as string)
		.join("\n")
		.trim();
}

/** Whether a message has any non-empty text part. */
export function hasText(parts: unknown): boolean {
	return partsText(parts).length > 0;
}

/** A tool part's input: `args`, else `state.input` (may be a JSON string). */
export function partInput(part: MessagePart): unknown {
	return (part as Record<string, unknown>).args ?? part.state?.input;
}

/**
 * Index (0-based) of the Nth user turn from the end, or `undefined` when there
 * are fewer than N user turns.
 */
export function nthUserTurnFromEnd(
	messages: Message[],
	n: number,
): number | undefined {
	if (n <= 0) return undefined;
	let seen = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].info.role === "user") {
			seen++;
			if (seen >= n) return i;
		}
	}
	return undefined;
}

/**
 * Indices of the last N user turns (from the Nth user turn to the end). When
 * there are fewer than N user turns, every message is included.
 */
export function getRecentTurnIndices(
	messages: Message[],
	protectedTurns: number,
): Set<number> {
	const indices = new Set<number>();
	if (protectedTurns <= 0) return indices;
	const start = nthUserTurnFromEnd(messages, protectedTurns) ?? 0;
	for (let i = start; i < messages.length; i++) indices.add(i);
	return indices;
}
