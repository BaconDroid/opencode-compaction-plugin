/**
 * The `experimental.chat.messages.transform` pipeline: applies the queued
 * compress/squash/expand requests, then trimming, dedup, error purge and
 * (opt-in) graduated eviction — before OpenCode's own truncation.
 */

import { getRecentTurnIndices } from "./messages.js";
import { hasProtectedFilePath, trimToolOutput } from "./trim.js";
import {
	applyCascadePurge,
	applyDedup,
	applyPurgeErrors,
} from "./strategies.js";
import { applyEviction } from "./eviction.js";
import { applyPendingRequests, type RequestDeps } from "./requests.js";
import type { Message } from "../types.js";

export interface TransformDeps extends RequestDeps {
	trimMap: Record<string, number>;
	defaultTrim: number;
	protectedPatterns: string[];
	turnProtectionEnabled: boolean;
	protectedTurns: number;
}

export function applyTransform(messages: Message[], deps: TransformDeps): void {
	// 0. Apply pending compression/squash/expand requests.
	applyPendingRequests(messages, deps);

	const { config, logger } = deps;

	// 1. Compute turn-protected indices (messages within last N user turns).
	const recentIndices = deps.turnProtectionEnabled
		? getRecentTurnIndices(messages, deps.protectedTurns)
		: new Set<number>();

	// 2. Trim tool outputs with protection checks.
	for (let mi = 0; mi < messages.length; mi++) {
		if (recentIndices.has(mi)) continue;
		for (const part of messages[mi].parts) {
			if (
				part.type !== "tool" ||
				!part.state ||
				typeof part.state.output !== "string" ||
				!part.tool
			) {
				continue;
			}
			if (hasProtectedFilePath(part, deps.protectedPatterns)) continue;
			part.state.output = trimToolOutput(
				part.tool,
				part.state.output,
				deps.trimMap,
				deps.defaultTrim,
			);
		}
	}

	// 3. Dedup repeated tool calls.
	if (config.dedup?.enabled) {
		const deduped = applyDedup(messages, config);
		if (deduped > 0) logger.info("dedup applied", { count: deduped });
	}

	// 4. Purge errored tool inputs (older than purgeErrors.turns).
	if (config.purgeErrors?.enabled) {
		const purgeProtected = getRecentTurnIndices(
			messages,
			config.purgeErrors.turns ?? 4,
		);
		const purgedCallIds = new Set<string>();
		const purged = applyPurgeErrors(
			messages,
			config,
			purgeProtected,
			purgedCallIds,
		);
		if (purged > 0) logger.info("error purge applied", { count: purged });

		// 4b. Cascade the purge to work depending on purged calls.
		if ((config.purgeErrors.cascade ?? true) && purgedCallIds.size > 0) {
			const cascaded = applyCascadePurge(
				messages,
				purgedCallIds,
				purgeProtected,
			);
			if (cascaded > 0) {
				logger.info("cascade purge applied", { count: cascaded });
			}
		}
	}

	// 5. Graduated eviction (runs last; content-addressed, never user turns).
	if (config.eviction?.enabled) {
		const { removed, evictedIds } = applyEviction(messages, {
			enabled: true,
			thresholdTokens: config.eviction.thresholdTokens ?? 80000,
			levels: config.eviction.levels,
			protectPrologue: config.eviction.protectPrologue ?? true,
		});
		if (removed > 0) {
			logger.info("eviction applied", { removed, ids: evictedIds.length });
		}
	}
}
