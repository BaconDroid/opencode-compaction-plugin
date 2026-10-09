/**
 * Applies the queued model-driven compression requests to the message array.
 *
 * The transform hook receives no session id, so a compression is scoped by the
 * callID of its compress tool call: a request queued for one session is never
 * applied to another. Non-matching requests stay queued until they expire.
 */

import type { ResolvedConfig } from "../config/config.js";
import type { Logger, Message } from "../types.js";
import type { CompressionStore } from "./compress.js";
import { applyCompressions, selectCompressions } from "./compress.js";

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
}

export function applyPendingRequests(
	messages: Message[],
	deps: RequestDeps,
): void {
	const { config, logger, compressions } = deps;

	// Only sessions with a queued request need processing (not every tracked
	// session), keeping the per-transform cost proportional to pending work.
	// Snapshot the ids: `drain` removes a session and `requeueDeferred` re-adds
	// it, so iterating the live key set would never terminate.
	for (const sid of [...compressions.sessions()]) {
		const requests = compressions.drain(sid);
		if (requests.length === 0) continue;

		const { applicable, deferred } = selectCompressions(messages, requests);

		if (applicable.length > 0) {
			const replaced = applyCompressions(messages, applicable, {
				protectedTurns: config.compress?.protectedTurns ?? 3,
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
}
