/**
 * Reversible compression: an in-memory sidecar of the original messages that a
 * `<compressed-block>` replaced, plus the `expand`/`recall` tools to restore
 * them. This is the minimal internal version — no index, no vectors, no disk.
 */

import { tool } from "@opencode-ai/plugin";
import {
	orderCompressBlocks,
	parseCompressBlocks,
	type BlockMessage,
} from "./blocks.js";

export interface ExpansionRecord {
	id: string;
	label?: string;
	original: unknown[];
	createdAt: number;
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

	save(sessionID: string, id: string, original: unknown[]): void {
		this.records.set(id, { id, original, createdAt: Date.now() });
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
export class ExpandStore {
	private queues = new Map<string, ExpandRequest[]>();

	queue(sessionID: string, request: ExpandRequest): void {
		let queue = this.queues.get(sessionID);
		if (!queue) {
			queue = [];
			this.queues.set(sessionID, queue);
		}
		queue.push(request);
	}

	/**
	 * Return the active requests for a session. Sticky requests are retained for
	 * the next transform; one-shot requests are returned only once.
	 */
	drain(sessionID: string): ExpandRequest[] {
		const queue = this.queues.get(sessionID) ?? [];
		const sticky = queue.filter((req) => req.mode === "sticky");
		if (sticky.length > 0) this.queues.set(sessionID, sticky);
		else this.queues.delete(sessionID);
		return queue;
	}

	clear(sessionID: string): void {
		this.queues.delete(sessionID);
	}

	clearAll(): void {
		this.queues.clear();
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
	const planned: { index: number; original: unknown[] }[] = [];
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
		planned.push({ index: block.index, original: record.original });
	}

	planned.sort((a, b) => b.index - a.index);
	let expanded = 0;
	for (const { index, original } of planned) {
		if (index < 0 || index >= messages.length) continue;
		messages.splice(index, 1, ...(original as BlockMessage[]));
		expanded++;
	}

	return { expanded, unmatched };
}

/**
 * Build the `expand` tool: restore a compressed block from the sidecar and keep
 * it expanded on subsequent transforms (sticky).
 */
export function buildExpandToolDef() {
	return tool({
		description: `Expand a compressed block, restoring its original messages.

Reference the block by its [bN] label (or durable id). The expansion is sticky:
the block stays expanded on later turns.`,
		args: {
			block: tool.schema
				.string()
				.describe("Block label (e.g. 'b0') or durable id to expand"),
		},
		async execute(args) {
			return `Expansion queued for block ${args.block}. It will be applied on the next message transform.`;
		},
	});
}

/**
 * Build the `recall` tool: restore a compressed block for a single transform
 * (one-shot).
 */
export function buildRecallToolDef() {
	return tool({
		description: `Recall a compressed block's original messages for the next turn only.

Reference the block by its [bN] label (or durable id). Unlike expand, the
expansion is one-shot and the block re-compresses afterwards.`,
		args: {
			block: tool.schema
				.string()
				.describe("Block label (e.g. 'b0') or durable id to recall"),
		},
		async execute(args) {
			return `Recall queued for block ${args.block}. It will be applied on the next message transform.`;
		},
	});
}
