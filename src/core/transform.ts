/**
 * The `experimental.chat.messages.transform` pipeline: applies the queued
 * compress/expand requests, then dedup, error purge and (opt-in) graduated
 * eviction — before OpenCode's own truncation.
 */

import { getRecentTurnIndices } from "./messages.js";
import {
	applyCascadePurge,
	applyDedup,
	applyPurgeErrors,
} from "./strategies.js";
import { applyEviction } from "./eviction.js";
import { applyPendingRequests, type RequestDeps } from "./requests.js";
import { buildScorerEstimator, type ScorerEstimator } from "./scorer.js";
import type { Scorer } from "./adapters.js";
import type { Message } from "../types.js";

export interface TransformDeps extends RequestDeps {
	/** Optional residual/perplexity scorer (E5); absent → heuristic estimate. */
	scorer?: Scorer;
	/** Max distinct texts scored per transform when `scorer` is set. */
	scorerMaxSamples?: number;
}

export async function applyTransform(
	messages: Message[],
	deps: TransformDeps,
): Promise<void> {
	// 0. Apply pending compression/expand requests.
	applyPendingRequests(messages, deps);

	const { config, logger } = deps;

	// 1. Dedup repeated tool calls.
	if (config.dedup?.enabled) {
		const deduped = applyDedup(messages, config);
		if (deduped > 0) logger.info("dedup applied", { count: deduped });
	}

	// 2. Purge errored tool inputs (older than purgeErrors.turns).
	if (config.purgeErrors?.enabled) {
		const purgeTurns = config.purgeErrors.turns ?? 4;
		const purgeProtected = getRecentTurnIndices(messages, purgeTurns);
		const purgedCallIds = new Set<string>();
		const purged = applyPurgeErrors(
			messages,
			config,
			purgeProtected,
			purgedCallIds,
		);
		if (purged > 0) logger.info("error purge applied", { count: purged });

		// 2b. Cascade the purge to work depending on purged calls.
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

	// 3. Graduated eviction (runs last; content-addressed, never user turns).
	if (config.eviction?.enabled) {
		// Optional scorer adapter (E5): calibrate the budget estimate. Any error
		// falls back to the heuristic `estimateTokens` (fail-open).
		let scorerEstimator: ScorerEstimator | undefined;
		if (deps.scorer) {
			try {
				scorerEstimator = await buildScorerEstimator(
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
			thresholdTokens: config.eviction.thresholdTokens ?? 200000,
			levels: config.eviction.levels,
			protectPrologue: config.eviction.protectPrologue ?? true,
			estimate: scorerEstimator,
			resolveText: scorerEstimator?.resolveText,
		});
		if (removed > 0) {
			logger.info("eviction applied", { removed, ids: evictedIds.length });
		}
	}
}
