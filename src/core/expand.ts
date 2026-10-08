/**
 * Reversible compression: an in-memory sidecar of the original messages that a
 * `<compressed-block>` replaced, plus the `expand`/`recall` tools to restore
 * them. This is the minimal internal version — no index, no vectors, no disk.
 */

import {
	orderCompressBlocks,
	parseCompressBlocks,
	type BlockMessage,
} from "./blocks.js";
import { partsText } from "./messages.js";
import { KeyedQueue } from "./store.js";
import type { VectorHit } from "./adapters.js";

export interface ExpansionRecord {
	id: string;
	label?: string;
	topic?: string;
	original: unknown[];
	createdAt: number;
}

export interface SearchHit {
	id: string;
	label?: string;
	topic?: string;
	snippet: string;
}

/** Flatten a stored record's original messages into searchable text. */
export function recordText(record: ExpansionRecord): string {
	return (record.original as Array<{ parts?: unknown }>)
		.map((message) => partsText(message?.parts))
		.filter(Boolean)
		.join("\n");
}

export type ExpandMode = "sticky" | "once";

export interface ExpandRequest {
	/** Block reference: its `bN` label or durable id. */
	block: string;
	mode: ExpandMode;
	callID?: string;
	timestamp: number;
}

/** Per-plugin-instance store of original messages, keyed by block id. */
export class ExpansionSidecar {
	private records = new Map<string, ExpansionRecord>();
	private bySession = new Map<string, Set<string>>();

	save(
		sessionID: string,
		id: string,
		original: unknown[],
		meta?: { label?: string; topic?: string },
	): void {
		this.records.set(id, {
			id,
			label: meta?.label,
			topic: meta?.topic,
			original,
			createdAt: Date.now(),
		});
		let ids = this.bySession.get(sessionID);
		if (!ids) {
			ids = new Set();
			this.bySession.set(sessionID, ids);
		}
		ids.add(id);
	}

	get(id: string): ExpansionRecord | undefined {
		return this.records.get(id);
	}

	/** All stored records, newest first. */
	list(): ExpansionRecord[] {
		return this.listForSession(undefined);
	}

	/**
	 * Stored records for a session, newest first. Without a session id, every
	 * record is returned (backward compatible; the SDK always supplies one).
	 */
	listForSession(sessionID?: string): ExpansionRecord[] {
		// A known session with no records must return nothing, not everything.
		const ids =
			sessionID === undefined
				? undefined
				: (this.bySession.get(sessionID) ?? new Set<string>());
		return [...this.records.values()]
			.filter((record) => ids === undefined || ids.has(record.id))
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	/**
	 * Deterministic keyword search over the stored originals (case-insensitive
	 * substring, no embeddings). Returns up to `maxResults` hits with a snippet.
	 */
	search(query: string, maxResults: number, sessionID?: string): SearchHit[] {
		const needle = query.trim().toLowerCase();
		if (!needle || maxResults <= 0) return [];
		const hits: SearchHit[] = [];
		for (const record of this.listForSession(sessionID)) {
			const text = recordText(record);
			const index = text.toLowerCase().indexOf(needle);
			if (index === -1) continue;
			const start = Math.max(0, index - 40);
			const end = Math.min(text.length, index + needle.length + 80);
			hits.push({
				id: record.id,
				label: record.label,
				topic: record.topic,
				snippet:
					(start > 0 ? "…" : "") +
					text.slice(start, end).replace(/\s+/g, " ") +
					(end < text.length ? "…" : ""),
			});
			if (hits.length >= maxResults) break;
		}
		return hits;
	}

	clear(sessionID: string): void {
		const ids = this.bySession.get(sessionID);
		if (ids) {
			for (const id of ids) this.records.delete(id);
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
	/**
	 * Return the active requests for a session. Sticky requests are retained for
	 * the next transform; one-shot requests are returned only once.
	 */
	override drain(sessionID: string): ExpandRequest[] {
		const queue = this.take(sessionID);
		this.retain(
			sessionID,
			queue.filter((req) => req.mode === "sticky"),
		);
		return queue;
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
): ApplyExpansionsResult {
	if (requests.length === 0) return { expanded: 0, unmatched: [] };

	const blocks = orderCompressBlocks(parseCompressBlocks(messages));
	// Dedupe by target index: two requests for the same block (e.g. expand +
	// recall, or a repeated expand) must restore it once, not twice.
	const planned = new Map<number, unknown[]>();
	const unmatched: string[] = [];

	for (const req of requests) {
		const block = blocks.find(
			(b) => b.label === req.block || b.id === req.block,
		);
		if (!block) {
			unmatched.push(req.block);
			continue;
		}
		const record = sidecar.get(block.id);
		if (!record) {
			unmatched.push(req.block);
			continue;
		}
		if (!planned.has(block.index)) planned.set(block.index, record.original);
	}

	let expanded = 0;
	for (const [index, original] of [...planned].sort((a, b) => b[0] - a[0])) {
		if (index < 0 || index >= messages.length) continue;
		messages.splice(index, 1, ...(original as BlockMessage[]));
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

/** Format a list of hits, keyword or semantic, as a bullet report. */
export function renderHits(
	hits: SearchHit[],
	query: string,
	mode: "keyword" | "semantic" = "keyword",
): string {
	if (hits.length === 0) {
		return mode === "semantic"
			? `No stored block matches "${query}" semantically.`
			: `No stored block matches "${query}".`;
	}
	const suffix = mode === "semantic" ? " (semantic)" : "";
	return hits
		.map((hit) => {
			const label = hit.label ?? hit.id;
			const topic = hit.topic ? ` — ${hit.topic}` : "";
			return `- [${label}]${topic}${suffix}: ${hit.snippet}`;
		})
		.join("\n");
}

/** Search the stored blocks by keyword and format the hits. */
export function renderSearch(
	sidecar: ExpansionSidecar,
	query: string,
	maxResults: number,
	sessionID?: string,
): string {
	return renderHits(
		sidecar.search(query, maxResults, sessionID),
		query,
		"keyword",
	);
}

/**
 * Enrich ranked vector hits with the sidecar's metadata (label/topic) and a
 * leading snippet of the stored text. Unknown ids are dropped.
 */
export function semanticHits(
	sidecar: ExpansionSidecar,
	hits: VectorHit[],
	snippetLength = 160,
): SearchHit[] {
	const out: SearchHit[] = [];
	for (const hit of hits) {
		const record = sidecar.get(hit.id);
		if (!record) continue;
		const text = recordText(record);
		const snippet = text.slice(0, snippetLength).replace(/\s+/g, " ");
		out.push({
			id: record.id,
			label: record.label,
			topic: record.topic,
			snippet: text.length > snippetLength ? `${snippet}…` : snippet,
		});
	}
	return out;
}

