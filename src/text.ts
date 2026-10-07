/** Helpers to read text out of OpenCode message parts. */

import type { MessagePart } from "./types.js";

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
