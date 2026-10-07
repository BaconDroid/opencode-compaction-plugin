/**
 * Message-part helpers (text, tool input, user-turn counting) and tool-output
 * trimming with protected-file patterns and turn protection.
 */

import type { LiveCompactionConfig } from "./config.js";
import { extractFilePaths, isFileProtected } from "./glob.js";
import type { Message, MessagePart } from "./types.js";

// ---------------------------------------------------------------------------
// Message-part helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool-output trimming
// ---------------------------------------------------------------------------

export function buildTrimMap(
	config: LiveCompactionConfig,
): Record<string, number> {
	return {
		bash: config.trim?.bash ?? 600,
		write: config.trim?.write ?? 100,
		edit: config.trim?.edit ?? 100,
		delete: config.trim?.delete ?? 50,
		read: config.trim?.read ?? 300,
		glob: config.trim?.glob ?? 200,
		grep: config.trim?.grep ?? 400,
		list: config.trim?.list ?? 200,
	};
}

const TRIMMED_MARKER = /\n\.\.\. \[trimmed \d+\/\d+ chars\]$/;

export function trimToolOutput(
	toolName: string,
	output: string,
	trimMap: Record<string, number>,
	defaultLimit: number,
): string {
	// Already trimmed in a previous transform pass: leave it as-is so the
	// retained tail is not re-sliced and eroded on every message batch.
	if (TRIMMED_MARKER.test(output)) return output;

	const limit = trimMap[toolName] ?? defaultLimit;
	if (output.length <= limit) return output;

	const indicator = `\n... [trimmed ${output.length - limit}/${output.length} chars]`;
	// Keep the END of output (usually has the important result/error)
	return output.slice(-limit) + indicator;
}

/**
 * Check if a tool part's args contain a file path matching protected patterns.
 */
export function hasProtectedFilePath(
	part: MessagePart,
	protectedPatterns: string[],
): boolean {
	if (protectedPatterns.length === 0) return false;

	// `args` may live under `args` or `state.input`, and the latter may be JSON.
	const raw = partInput(part);
	let args: Record<string, unknown> | undefined;
	if (typeof raw === "string") {
		try {
			args = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			args = undefined;
		}
	} else if (raw && typeof raw === "object") {
		args = raw as Record<string, unknown>;
	}
	if (!args) return false;

	const paths = extractFilePaths(part.tool ?? "", args);
	return isFileProtected(paths, protectedPatterns);
}
