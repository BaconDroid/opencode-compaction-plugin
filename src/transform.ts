/**
 * The `experimental.chat.messages.transform` pipeline: applies pending
 * compression/squash/expand requests, then trimming, dedup, error purge and
 * (opt-in) graduated eviction — before OpenCode's own truncation.
 */

import type { ResolvedConfig } from "./config.js";
import type { Logger } from "./types.js";
import type {
	CompressionStore,
	SquashStore,
} from "./compress.js";
import {
	applyCompressions,
	applySquash,
	selectCompressions,
} from "./compress.js";
import type { ExpansionSidecar, ExpandStore } from "./expand.js";
import { applyExpansions } from "./expand.js";
import {
	applyCascadePurge,
	applyDedup,
	applyPurgeErrors,
} from "./strategies.js";
import { applyEviction } from "./eviction.js";
import {
	getRecentTurnIndices,
	hasProtectedFilePath,
	trimToolOutput,
} from "./trim.js";
import type { Message } from "./types.js";

// Deferred compression requests older than this are dropped (N2).
const DEFERRED_COMPRESSION_MAX_AGE_MS = 30 * 60 * 1000;

export interface TransformDeps {
	config: ResolvedConfig;
	logger: Logger;
	/** Sessions with activity (used to route per-session requests). */
	sessionIDs: Iterable<string>;
	compressions: CompressionStore;
	squashes: SquashStore;
	expansions: ExpansionSidecar;
	expandStore: ExpandStore;
	trimMap: Record<string, number>;
	defaultTrim: number;
	protectedPatterns: string[];
	turnProtectionEnabled: boolean;
	protectedTurns: number;
}

export function applyTransform(messages: Message[], deps: TransformDeps): void {
	const {
		config,
		logger,
		compressions,
		squashes,
		expansions,
		expandStore,
	} = deps;

	// 0. Apply pending compression/squash/expand requests.
	// The transform hook receives no session id, so a compression is scoped by
	// the callID of its compress tool call: a request queued for one session is
	// never applied to another. Non-matching requests stay queued until they
	// expire.
	for (const sid of deps.sessionIDs) {
		// 0a. Compressions.
		const requests = compressions.drain(sid);
		if (requests.length > 0) {
			const { applicable, deferred } = selectCompressions(messages, requests);

			if (applicable.length > 0) {
				const reversible = config.compress?.reversible ?? true;
				const replaced = applyCompressions(messages, applicable, {
					protectedTurns: config.compress?.protectedTurns ?? 3,
					record: reversible
						? ({ id, original }) =>
								expansions.save(sid, id, original as unknown[])
						: undefined,
				});
				if (replaced > 0) {
					logger.info("compress applied", {
						sessionID: sid,
						messagesReplaced: replaced,
					});
				}
			}

			// Re-queue requests for a different conversation, unless stale.
			const now = Date.now();
			for (const req of deferred) {
				if (now - req.timestamp < DEFERRED_COMPRESSION_MAX_AGE_MS) {
					compressions.queue(sid, req);
				} else {
					logger.info("compress deferred request expired", {
						sessionID: sid,
						topic: req.topic,
					});
				}
			}
		}

		// 0b. Squash contiguous blocks.
		const squashRequests = squashes.drain(sid);
		if (squashRequests.length > 0) {
			const merged = applySquash(messages, squashRequests, {
				maxBlocks: config.compress?.maxBlocksPerSquash ?? 8,
			});
			if (merged > 0) {
				logger.info("squash applied", { sessionID: sid, blocksMerged: merged });
			}
		}

		// 0c. Expand compressed blocks back to their originals.
		const expandRequests = expandStore.drain(sid);
		if (expandRequests.length > 0) {
			const { expanded, unmatched } = applyExpansions(
				messages,
				expandRequests,
				expansions,
			);
			if (expanded > 0) {
				logger.info("expand applied", { sessionID: sid, expanded });
			}
			if (unmatched.length > 0) {
				logger.info("expand unmatched", { sessionID: sid, blocks: unmatched });
			}
		}
	}

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
