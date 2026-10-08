/**
 * Tool-output trimming with protected-file patterns and turn protection.
 */

import type { LiveCompactionConfig } from "../config/config.js";
import { extractFilePaths, isFileProtected } from "./glob.js";
import {
	DEDUPED_PREFIX,
	EVICTED_BULK_SUFFIX,
	TRIMMED_MARKER,
} from "./markers.js";
import { partInput } from "./messages.js";
import type { MessagePart } from "../types.js";

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

export function trimToolOutput(
	toolName: string,
	output: string,
	trimMap: Record<string, number>,
	defaultLimit: number,
): string {
	// Already processed in a previous pass or by another stage: leave it as-is
	// so markers are not truncated (which would break their idempotency).
	if (
		TRIMMED_MARKER.test(output) ||
		output.startsWith(DEDUPED_PREFIX) ||
		output.endsWith(EVICTED_BULK_SUFFIX)
	) {
		return output;
	}

	const limit = trimMap[toolName] ?? defaultLimit;
	// A non-positive limit means "keep nothing"; `slice(-0)` would otherwise
	// return the whole output while still appending a (false) trim marker.
	if (limit <= 0) {
		return output.length === 0
			? output
			: `\n... [trimmed ${output.length}/${output.length} chars]`;
	}
	if (output.length <= limit) return output;

	const indicator = `\n... [trimmed ${output.length - limit}/${output.length} chars]`;
	// Keep the END of output (usually has the important result/error). Never
	// enlarge: if the tail + marker is not shorter, leave the output as-is.
	const trimmed = output.slice(-limit) + indicator;
	return trimmed.length < output.length ? trimmed : output;
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

	const paths = extractFilePaths(args);
	return isFileProtected(paths, protectedPatterns);
}
