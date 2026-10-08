/**
 * Reversible compression: an in-memory sidecar of the original messages that a
 * `<compressed-block>` replaced, plus the `expand` tool (sticky or one-shot) to
 * restore them. This is the minimal internal version — no index, no vectors, no
 * disk.
 */

import {
	orderCompressBlocks,
	parseCompressBlocks,
	type BlockMessage,
	type CompressBlock,
} from "./blocks.js";
import { KeyedQueue } from "./store.js";

export interface ExpansionRecord {
	id: string;
	label?: string;
	topic?: string;
	original: unknown[];
	createdAt: number;
}

/** Separator for the per-session record key (never appears in block ids). */
const KEY_SEP = "\u0000";

export type ExpandMode = "sticky" | "once";

export interface ExpandRequest {
	/** Block reference: its `bN` label or durable id. */
	block: string;
	mode: ExpandMode;
	callID?: string;
	timestamp: number;
}

/** Per-plugin-instance store of original messages, keyed by session + block id. */
export class ExpansionSidecar {
	private records = new Map<string, ExpansionRecord>();
	// sessionID -> set of composite record keys.
	private bySession = new Map<string, Set<string>>();

	private key(sessionID: string, id: string): string {
		return `${sessionID}${KEY_SEP}${id}`;
	}

	save(
		sessionID: string,
		id: string,
		original: unknown[],
		meta?: { label?: string; topic?: string },
	): void {
		const key = this.key(sessionID, id);
		this.records.set(key, {
			id,
			label: meta?.label,
			topic: meta?.topic,
			original,
			createdAt: Date.now(),
		});
		let keys = this.bySession.get(sessionID);
		if (!keys) {
			keys = new Set();
			this.bySession.set(sessionID, keys);
		}
		keys.add(key);
	}

	/**
	 * A record by block id. With a session id the lookup is scoped to that
	 * session; without one, any session's record with that id is returned
	 * (backward compatible).
	 */
	get(id: string, sessionID?: string): ExpansionRecord | undefined {
		if (sessionID !== undefined) return this.records.get(this.key(sessionID, id));
		for (const record of this.records.values()) {
			if (record.id === id) return record;
		}
		return undefined;
	}

	/**
	 * Stored records for a session, newest first. Without a session id, every
	 * record is returned (backward compatible; the SDK always supplies one).
	 */
	listForSession(sessionID?: string): ExpansionRecord[] {
		// A known session with no records must return nothing, not everything.
		const records =
			sessionID === undefined
				? [...this.records.values()]
				: [...(this.bySession.get(sessionID) ?? [])]
						.map((key) => this.records.get(key))
						.filter((record): record is ExpansionRecord => record !== undefined);
		return records.sort((a, b) => b.createdAt - a.createdAt);
	}

	clear(sessionID: string): void {
		const keys = this.bySession.get(sessionID);
		if (keys) {
			for (const key of keys) this.records.delete(key);
			this.bySession.delete(sessionID);
		}
	}

	clearAll(): void {
		this.records.clear();
		this.bySession.clear();
	}

	get size(): number {
		return this.records.size;
	}
}

/** Per-plugin-instance store of pending expand requests, keyed by session. */
export class ExpandStore extends KeyedQueue<ExpandRequest> {
	/** Keep at most one request per block to bound the queue. */
	override queue(sessionID: string, item: ExpandRequest): void {
		const existing = this.take(sessionID);
		const index = existing.findIndex((req) => req.block === item.block);
		if (index !== -1) {
			// A one-shot must not cancel a sticky retention for the same block.
			if (existing[index].mode === "sticky" && item.mode === "once") {
				this.retain(sessionID, existing);
				return;
			}
			existing.splice(index, 1);
		}
		existing.push(item);
		this.retain(sessionID, existing);
	}

	/**
	 * Return the active requests for a session. Sticky requests are retained for
	 * the next transform; one-shot requests are returned only once.
	 */
	drain(sessionID: string): ExpandRequest[] {
		const queue = this.take(sessionID);
		this.retain(
			sessionID,
			queue.filter((req) => req.mode === "sticky"),
		);
		return queue;
	}

	/** Drop retained sticky requests for blocks that no longer resolve. */
	prune(sessionID: string, blocks: string[]): void {
		if (blocks.length === 0) return;
		const gone = new Set(blocks);
		const remaining = this.take(sessionID).filter(
			(req) => !(req.mode === "sticky" && gone.has(req.block)),
		);
		this.retain(sessionID, remaining);
	}
}

export interface ApplyExpansionsResult {
	expanded: number;
	unmatched: string[];
}

/**
 * Replace `<compressed-block>` messages with their originals from the sidecar.
 * Processes from the end of the array so indices stay stable. Returns the
 * number of blocks expanded and the references that could not be resolved.
 */
export function applyExpansions(
	messages: BlockMessage[],
	requests: ExpandRequest[],
	sidecar: ExpansionSidecar,
	sessionID?: string,
): ApplyExpansionsResult {
	if (requests.length === 0) return { expanded: 0, unmatched: [] };

	const blocks = orderCompressBlocks(parseCompressBlocks(messages));
	const byRef = new Map<string, CompressBlock>();
	for (const block of blocks) {
		if (block.label !== undefined) byRef.set(block.label, block);
		byRef.set(block.id, block);
	}
	// Dedupe by target index: two requests for the same block (e.g. a sticky
	// plus a one-shot expand) must restore it once, not twice.
	const planned = new Map<number, unknown[]>();
	const unmatched: string[] = [];

	for (const req of requests) {
		const block = byRef.get(req.block);
		if (!block) {
			unmatched.push(req.block);
			continue;
		}
		const record = sidecar.get(block.id, sessionID);
		if (!record) {
			unmatched.push(req.block);
			continue;
		}
		if (!planned.has(block.index)) planned.set(block.index, record.original);
	}

	let expanded = 0;
	for (const [index, original] of [...planned].sort((a, b) => b[0] - a[0])) {
		if (index < 0 || index >= messages.length) continue;
		// Clone so later dedup/purge/eviction cannot mutate the stored originals
		// (which would make a second expand restore corrupted text).
		messages.splice(index, 1, ...(structuredClone(original) as BlockMessage[]));
		expanded++;
	}

	return { expanded, unmatched };
}

/** List the stored blocks as a short human-readable report. */
export function renderInspector(
	sidecar: ExpansionSidecar,
	sessionID?: string,
): string {
	const records = sidecar.listForSession(sessionID);
	if (records.length === 0) return "No compressed blocks are stored.";
	return records
		.map((record) => {
			const label = record.label ?? record.id;
			const topic = record.topic ? ` — ${record.topic}` : "";
			return `- [${label}]${topic} (${record.original.length} messages, id=${record.id})`;
		})
		.join("\n");
}
