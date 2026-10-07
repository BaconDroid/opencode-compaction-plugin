/**
 * Tool-output trimming with protected-file patterns and turn protection.
 */

import type { LiveCompactionConfig } from "./config.js";
import { extractFilePaths, isFileProtected } from "./glob.js";
import { partInput } from "./text.js";
import type { Message, MessagePart } from "./types.js";

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
 * Count user message boundaries from the end of the messages array.
 * Returns a set of message indices that fall within the last N user turns.
 */
export function getRecentTurnIndices(
	messages: Message[],
	protectedTurns: number,
): Set<number> {
	const recentIndices = new Set<number>();
	if (protectedTurns <= 0) return recentIndices;
	let userTurnsFromEnd = 0;

	for (let i = messages.length - 1; i >= 0; i--) {
		recentIndices.add(i);

		if (messages[i].info.role === "user") {
			userTurnsFromEnd++;
			if (userTurnsFromEnd >= protectedTurns) break;
		}
	}

	return recentIndices;
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
