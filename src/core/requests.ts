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
	belongsToBatch,
	presentCallIds,
	selectCompressions,
} from "./compress.js";
import type { ExpansionSidecar, ExpandStore } from "./expand.js";
import { applyExpansions } from "./expand.js";

// Deferred compression requests older than this are dropped (N2).
const DEFERRED_COMPRESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** Requeue requests that belong to another conversation, unless they are stale. */
function requeueDeferred<T extends { timestamp: number }>(
	store: { queue(sessionID: string, item: T): void },
	sessionID: string,
	deferred: T[],
	logger: Logger,
	label: string,
): void {
	const now = Date.now();
	for (const req of deferred) {
		if (now - req.timestamp < DEFERRED_COMPRESSION_MAX_AGE_MS) {
			store.queue(sessionID, req);
		} else {
			logger.info(`${label} deferred request expired`, { sessionID });
		}
	}
}

export interface RequestDeps {
	config: ResolvedConfig;
	logger: Logger;
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

	// Requests are scoped to their originating conversation by callID. The set
	// of callIDs must be recomputed after compressions, which mutate `messages`.
	const reversible = config.compress?.reversible ?? false;

	// Only sessions with a queued request need processing (not every tracked
	// session), keeping the per-transform cost proportional to pending work.
	const sessions = new Set<string>();
	for (const store of [compressions, squashes, expandStore]) {
		for (const sid of store.sessions()) sessions.add(sid);
	}

	for (const sid of sessions) {
		// Compressions (selectCompressions recomputes the present set itself).
		const requests = compressions.drain(sid);
		if (requests.length > 0) {
			const { applicable, deferred } = selectCompressions(messages, requests);

			if (applicable.length > 0) {
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

			requeueDeferred(compressions, sid, deferred, logger, "compress");
		}

		// Squash and expand run after compressions; neither changes tool
		// callIDs, so one present-set scan serves both.
		const squashRequests = squashes.drain(sid);
		const expandRequests = expandStore.drain(sid);
		if (squashRequests.length === 0 && expandRequests.length === 0) continue;
		const present = presentCallIds(messages);

		if (squashRequests.length > 0) {
			const applicable = squashRequests.filter((req) =>
				belongsToBatch(req.callID, present),
			);
			const merged = applySquash(messages, applicable, {
				maxBlocks: config.compress?.maxBlocksPerSquash ?? 8,
				record: reversible
					? ({ id, label, topic, constituentIds }) => {
							// Combine the constituents' originals so expanding the merged
							// block restores the whole history, not just the first block.
							const originals = constituentIds.flatMap(
								(blockId) => expansions.get(blockId, sid)?.original ?? [],
							);
							if (originals.length > 0) {
								expansions.save(sid, id, originals, { label, topic });
							}
							// Drop the merged-away records so inspect/search do not report
							// phantom blocks.
							for (const blockId of constituentIds) {
								if (blockId !== id) expansions.delete(sid, blockId);
							}
						}
					: undefined,
			});
			if (merged > 0) {
				logger.info("squash applied", { sessionID: sid, blocksMerged: merged });
			}
			requeueDeferred(
				squashes,
				sid,
				squashRequests.filter((req) => !belongsToBatch(req.callID, present)),
				logger,
				"squash",
			);
		}

		// Expand compressed blocks back to their originals. `drain` retains
		// sticky requests; deferred one-shot requests are requeued here.
		if (expandRequests.length > 0) {
			const applicable = expandRequests.filter((req) =>
				belongsToBatch(req.callID, present),
			);
			const { expanded, unmatched } = applyExpansions(
				messages,
				applicable,
				expansions,
				sid,
			);
			if (expanded > 0) {
				logger.info("expand applied", { sessionID: sid, expanded });
			}
			if (unmatched.length > 0) {
				logger.info("expand unmatched", { sessionID: sid, blocks: unmatched });
			}
			// Drop retained sticky requests for blocks that no longer exist, so
			// they do not accumulate/re-log every transform.
			expandStore.prune(sid, unmatched);
			requeueDeferred(
				expandStore,
				sid,
				expandRequests.filter(
					(req) =>
						req.mode === "once" && !belongsToBatch(req.callID, present),
				),
				logger,
				"expand",
			);
		}
	}
}
