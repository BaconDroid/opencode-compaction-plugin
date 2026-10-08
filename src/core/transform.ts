/**
 * The `experimental.chat.messages.transform` pipeline: applies the queued
 * compress/squash/expand requests, then trimming, dedup, error purge and
 * (opt-in) graduated eviction — before OpenCode's own truncation.
 */

import { getRecentTurnIndices } from "./messages.js";
import { isPinnedMessage } from "./pin.js";
import { hasProtectedFilePath, trimToolOutput } from "./trim.js";
import {
	applyCascadePurge,
	applyDedup,
	applyPurgeErrors,
} from "./strategies.js";
import { applyEviction } from "./eviction.js";
import { applyPendingRequests, type RequestDeps } from "./requests.js";
import { buildScorerEstimator } from "./scorer.js";
import type { Scorer } from "./adapters.js";
import type { Message } from "../types.js";

export interface TransformDeps extends RequestDeps {
	trimMap: Record<string, number>;
	defaultTrim: number;
	protectedPatterns: string[];
	turnProtectionEnabled: boolean;
	protectedTurns: number;
	/** Optional residual/perplexity scorer (E5); absent → heuristic estimate. */
	scorer?: Scorer;
	/** Max distinct texts scored per transform when `scorer` is set. */
	scorerMaxSamples?: number;
}

export async function applyTransform(
	messages: Message[],
	deps: TransformDeps,
): Promise<void> {
	// 0. Apply pending compression/squash/expand requests.
	applyPendingRequests(messages, deps);

	const { config, logger } = deps;

	// 1. Compute turn-protected and pinned indices.
	const recentIndices = deps.turnProtectionEnabled
		? getRecentTurnIndices(messages, deps.protectedTurns)
		: new Set<number>();

	const pinningPatterns =
		config.pinning?.enabled === false
			? []
			: (config.pinning?.patterns ?? []);
	const pinnedIndices = new Set<number>();
	if (pinningPatterns.length > 0) {
		for (let i = 0; i < messages.length; i++) {
			if (isPinnedMessage(messages[i], pinningPatterns)) pinnedIndices.add(i);
		}
	}

	// 2. Trim tool outputs with protection checks.
	for (let mi = 0; mi < messages.length; mi++) {
		if (recentIndices.has(mi) || pinnedIndices.has(mi)) continue;
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
		const deduped = applyDedup(messages, config, pinnedIndices);
		if (deduped > 0) logger.info("dedup applied", { count: deduped });
	}

	// 4. Purge errored tool inputs (older than purgeErrors.turns).
	if (config.purgeErrors?.enabled) {
		const purgeProtected = getRecentTurnIndices(
			messages,
			config.purgeErrors.turns ?? 4,
		);
		for (const index of pinnedIndices) purgeProtected.add(index);
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
		// Optional scorer adapter (E5): calibrate the budget estimate. Any error
		// falls back to the heuristic `estimateTokens` (fail-open).
		let estimate: ((messages: Message[]) => number) | undefined;
		if (deps.scorer) {
			try {
				estimate = await buildScorerEstimator(
					deps.scorer,
					messages,
					deps.scorerMaxSamples,
				);
			} catch (error) {
				logger.warn("scorer adapter failed; using heuristic estimate", {
					error: String(error),
				});
			}
		}
		const { removed, evictedIds } = applyEviction(messages, {
			enabled: true,
			thresholdTokens: config.eviction.thresholdTokens ?? 80000,
			levels: config.eviction.levels,
			protectPrologue: config.eviction.protectPrologue ?? true,
			protectedIndices: pinnedIndices,
			estimate,
		});
		if (removed > 0) {
			logger.info("eviction applied", { removed, ids: evictedIds.length });
		}
	}
}
