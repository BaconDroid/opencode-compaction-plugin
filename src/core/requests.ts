/**
 * Applies the queued model-driven requests (compress / squash / expand) to the
 * message array.
 *
 * The transform hook receives no session id, so a compression is scoped by the
 * callID of its compress tool call: a request queued for one session is never
 * applied to another. Non-matching requests stay queued until they expire.
 */

import type { ResolvedConfig } from "../config/config.js";
import type { Logger, Message } from "../types.js";
import type { CompressionStore, SquashStore } from "./compress.js";
import {
	applyCompressions,
	applySquash,
	selectCompressions,
} from "./compress.js";
import type { ExpansionSidecar, ExpandStore } from "./expand.js";
import { applyExpansions } from "./expand.js";

// Deferred compression requests older than this are dropped (N2).
const DEFERRED_COMPRESSION_MAX_AGE_MS = 30 * 60 * 1000;

export interface RequestDeps {
	config: ResolvedConfig;
	logger: Logger;
	/** Sessions with activity (used to route per-session requests). */
	sessionIDs: Iterable<string>;
	compressions: CompressionStore;
	squashes: SquashStore;
	expansions: ExpansionSidecar;
	expandStore: ExpandStore;
}

export function applyPendingRequests(
	messages: Message[],
	deps: RequestDeps,
): void {
	const { config, logger, compressions, squashes, expansions, expandStore } =
		deps;

	for (const sid of deps.sessionIDs) {
		// Compressions.
		const requests = compressions.drain(sid);
		if (requests.length > 0) {
			const { applicable, deferred } = selectCompressions(messages, requests);

			if (applicable.length > 0) {
				const reversible = config.compress?.reversible ?? true;
				const replaced = applyCompressions(messages, applicable, {
					protectedTurns: config.compress?.protectedTurns ?? 3,
					record: reversible
						? ({ id, label, topic, original }) =>
								expansions.save(sid, id, original as unknown[], {
									label,
									topic,
								})
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

		// Squash contiguous blocks.
		const squashRequests = squashes.drain(sid);
		if (squashRequests.length > 0) {
			const merged = applySquash(messages, squashRequests, {
				maxBlocks: config.compress?.maxBlocksPerSquash ?? 8,
			});
			if (merged > 0) {
				logger.info("squash applied", { sessionID: sid, blocksMerged: merged });
			}
		}

		// Expand compressed blocks back to their originals.
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
}
