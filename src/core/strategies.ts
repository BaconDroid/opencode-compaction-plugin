/**
 * Context optimization strategies for opencode-compaction-plugin.
 *
 * - Deduplication: removes duplicate tool calls (same tool + same args), keeping only the latest.
 * - Error purge: strips input content from errored tool calls after N turns.
 *
 * Both strategies operate on the messages array in experimental.chat.messages.transform.
 */

import type { CompactionConfig } from "../config/config.js";
import { DEDUPED_PREFIX } from "./markers.js";
import { partInput, setPartInput } from "./messages.js";
import type { Message, MessagePart } from "../types.js";

// Deduplication

// A tool part's args object is stable across transforms (a purge replaces it,
// it is never mutated in place), so its serialization is cached per identity.
const argsKeyCache = new WeakMap<object, string>();

function serializedArgs(args: unknown): string {
	if (typeof args !== "object" || args === null) return JSON.stringify(args);
	const cached = argsKeyCache.get(args);
	if (cached !== undefined) return cached;
	const value = JSON.stringify(sortKeys(args));
	argsKeyCache.set(args, value);
	return value;
}

/**
 * Build a stable hash key for a tool call (tool name + serialized args).
 * Uses JSON.stringify with sorted keys for determinism.
 */
export function toolCallKey(tool: string, args: unknown): string {
	return `${tool}::${serializedArgs(args)}`;
}

/** Recursively sort object keys (including inside arrays) for a stable hash. */
function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(obj).sort()) sorted[key] = sortKeys(obj[key]);
		return sorted;
	}
	return value;
}

/**
 * Deduplicate tool calls in the messages array.
 *
 * For each (tool, args) pair, only the LAST occurrence is kept.
 * Earlier duplicates have their output replaced with a short marker.
 * Protected tools (in config) are never deduped.
 */
export function applyDedup(
	messages: Message[],
	config: CompactionConfig,
): number {
	if (!config.dedup?.enabled) return 0;

	const protectedTools = new Set(config.dedup.protectedTools ?? []);

	const seen = new Map<string, { msgIdx: number; partIdx: number }[]>();

	for (let mi = 0; mi < messages.length; mi++) {
		const parts = messages[mi]?.parts ?? [];
		for (let pi = 0; pi < parts.length; pi++) {
			const part = parts[pi];
			if (part.type !== "tool" || !part.tool) continue;
			if (protectedTools.has(part.tool)) continue;
			// Only completed tool parts have an output to dedup; error states
			// carry `error`, not `output`.
			if (typeof part.state?.output !== "string") continue;
			// Already deduped in a previous pass: leave it so the removed-char
			// count is not recomputed from the marker itself.
			if (part.state.output.startsWith(DEDUPED_PREFIX)) continue;

			const key = toolCallKey(part.tool, partInput(part));

			let positions = seen.get(key);
			if (!positions) {
				positions = [];
				seen.set(key, positions);
			}
			positions.push({ msgIdx: mi, partIdx: pi });
		}
	}

	let deduped = 0;

	for (const [_key, positions] of seen) {
		if (positions.length <= 1) continue;

		for (let i = 0; i < positions.length - 1; i++) {
			const { msgIdx, partIdx } = positions[i];
			const part = messages[msgIdx].parts[partIdx];
			if (part.state) {
				const originalLen = (part.state.output ?? "").length;
				part.state.output = `${DEDUPED_PREFIX}same call as later ${part.tool} output — ${originalLen} chars removed]`;
			}
			deduped++;
		}
	}

	return deduped;
}

// Error Purge

/**
 * Find tool parts that returned errors and whose input should be purged.
 * Returns indices of parts whose input will be stripped.
 */
export function findErroredParts(
	messages: Message[],
): { msgIdx: number; partIdx: number }[] {
	const errored: { msgIdx: number; partIdx: number }[] = [];

	for (let mi = 0; mi < messages.length; mi++) {
		const parts = messages[mi]?.parts ?? [];
		for (let pi = 0; pi < parts.length; pi++) {
			const part = parts[pi];
			if (part.type !== "tool" || !part.state) continue;

			const status = part.state.status;
			if (status === "error") {
				errored.push({ msgIdx: mi, partIdx: pi });
			}
		}
	}

	return errored;
}

/** True when an input is the marker left by a previous purge. */
function isPurgedInput(input: unknown): boolean {
	return (
		!!input &&
		typeof input === "object" &&
		typeof (input as { purged?: unknown }).purged === "string"
	);
}

/** Compact marker replacing a purged failed attempt's output. */
function errorExtract(part: MessagePart, output: unknown): string {
	const head =
		typeof output === "string"
			? output.replace(/\s+/g, " ").trim().slice(0, 100)
			: "";
	return `[purged failed ${part.tool ?? "tool"}: ${head}]`;
}

/**
 * Strip the input content from errored tool calls. When
 * `purgeErrors.wholeAttempt` is enabled (default), the output is replaced by a
 * compact extract too, so the failed attempt no longer occupies the context.
 * Message indices in `protectedIndices` (recent turns) are skipped so an error
 * the agent may still be working on is not purged.
 * Returns the number of parts purged.
 */
export function applyPurgeErrors(
	messages: Message[],
	config: CompactionConfig,
	protectedIndices?: Set<number>,
	purgedCallIds?: Set<string>,
): number {
	if (!config.purgeErrors?.enabled) return 0;

	const wholeAttempt = config.purgeErrors.wholeAttempt ?? true;
	const erroredParts = findErroredParts(messages);
	let purged = 0;

	for (const { msgIdx, partIdx } of erroredParts) {
		if (protectedIndices?.has(msgIdx)) continue;
		const part = messages[msgIdx].parts[partIdx];
		const state = part.state;
		if (!state) continue;
		const input = partInput(part);
		if (input === undefined || input === null) continue;

		// Already purged in an earlier pass: re-report the call so the cascade can
		// still reach its dependents once their protection expires.
		if (isPurgedInput(input)) {
			if (purgedCallIds && typeof part.callID === "string") {
				purgedCallIds.add(part.callID);
			}
			continue;
		}

		const inputLen = serializeInput(part).length;
		if (inputLen > 100) {
			setPartInput(part, {
				purged: `${inputLen} chars of errored input removed`,
			});
			if (wholeAttempt) {
				state.output = errorExtract(part, state.output);
			}
			if (purgedCallIds && typeof part.callID === "string") {
				purgedCallIds.add(part.callID);
			}
			purged++;
		}
	}

	return purged;
}

/** Serialize a tool part's input/args for dependency scanning. */
function serializeInput(part: MessagePart): string {
	const raw = partInput(part);
	if (raw === undefined || raw === null) return "";
	return typeof raw === "string" ? raw : JSON.stringify(raw);
}

const ID_CHAR = /[A-Za-z0-9_-]/;

/** Maximal runs of id characters, used to find referenced call ids in O(text). */
const ID_RUN = /[A-Za-z0-9_-]+/g;

/** True when `text` references `id` as a whole token, not as a substring of a
 * longer id (so purging `abc` does not drag in work that only mentioned
 * `abcdef`). */
function referencesCall(text: string, id: string): boolean {
	if (!id) return false;
	let from = 0;
	while (from <= text.length) {
		const index = text.indexOf(id, from);
		if (index === -1) return false;
		const before = index > 0 ? text[index - 1] : "";
		const after = text[index + id.length] ?? "";
		if (!ID_CHAR.test(before) && !ID_CHAR.test(after)) return true;
		from = index + 1;
	}
	return false;
}

/**
 * Purge work that depends on already-purged tool calls.
 *
 * Dependencies are derived deterministically from the tool inputs: a part
 * depends on a call when its serialized input references that call's `callID`.
 * A contaminated part is purged only once every part that depends on it has
 * been purged (reverse topological order), so the message graph stays coherent.
 *
 * Complexity is linear in the number of tool parts: the dependency edges are
 * built by tokenizing each input once (not by scanning every id), and the
 * leaves-first purge is a topological peel rather than a fixpoint loop.
 *
 * Returns the number of parts purged.
 */
export function applyCascadePurge(
	messages: Message[],
	purgedCallIds: Set<string>,
	protectedIndices?: Set<number>,
): number {
	if (purgedCallIds.size === 0) return 0;

	const partsByCall = new Map<string, { msgIdx: number; partIdx: number }>();
	for (let mi = 0; mi < messages.length; mi++) {
		const parts = messages[mi]?.parts ?? [];
		for (let pi = 0; pi < parts.length; pi++) {
			const part = parts[pi];
			if (part.type === "tool" && typeof part.callID === "string") {
				partsByCall.set(part.callID, { msgIdx: mi, partIdx: pi });
			}
		}
	}

	// dependsOn: call -> calls its input references (call depends on them).
	// dependents: the reverse edges (call -> calls that reference it).
	const dependsOn = new Map<string, Set<string>>();
	const dependents = new Map<string, Set<string>>();
	const addEdge = (call: string, other: string): void => {
		let forward = dependsOn.get(call);
		if (!forward) {
			forward = new Set();
			dependsOn.set(call, forward);
		}
		forward.add(other);
		let reverse = dependents.get(other);
		if (!reverse) {
			reverse = new Set();
			dependents.set(other, reverse);
		}
		reverse.add(call);
	};

	// Ids that are not pure id-character runs cannot be found by tokenization;
	// match those (rare) with the exact substring scan.
	const irregular: string[] = [];
	for (const id of partsByCall.keys()) {
		if (!/^[A-Za-z0-9_-]+$/.test(id)) irregular.push(id);
	}

	for (const [call, pos] of partsByCall) {
		const inputText = serializeInput(messages[pos.msgIdx].parts[pos.partIdx]);
		if (!inputText) continue;
		ID_RUN.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = ID_RUN.exec(inputText)) !== null) {
			const token = match[0];
			if (token !== call && partsByCall.has(token)) addEdge(call, token);
		}
		for (const id of irregular) {
			if (id !== call && referencesCall(inputText, id)) addEdge(call, id);
		}
	}

	// Descendants of the purged work (transitive closure over dependents).
	const contaminated = new Set<string>();
	const stack = [...purgedCallIds];
	while (stack.length > 0) {
		const call = stack.pop() as string;
		for (const dep of dependents.get(call) ?? []) {
			if (!contaminated.has(dep) && !purgedCallIds.has(dep)) {
				contaminated.add(dep);
				stack.push(dep);
			}
		}
	}

	// Topological peel: a call is purgeable once all its dependents are purged.
	// Start from the leaves (no unpurged dependents) and walk the edges back.
	const pending = new Map<string, number>();
	const queue: string[] = [];
	for (const call of contaminated) {
		let n = 0;
		for (const dep of dependents.get(call) ?? []) {
			if (!purgedCallIds.has(dep)) n++;
		}
		pending.set(call, n);
		if (n === 0) queue.push(call);
	}

	const purgedNow = new Set<string>();
	let purged = 0;
	while (queue.length > 0) {
		const call = queue.pop() as string;
		if (purgedNow.has(call)) continue;
		const pos = partsByCall.get(call);
		if (!pos) continue;
		// A protected call is not purged, so its own dependencies stay blocked.
		if (protectedIndices?.has(pos.msgIdx)) continue;

		const part = messages[pos.msgIdx].parts[pos.partIdx];
		setPartInput(part, { purged: "cascade: depends on purged work" });
		if (part.state) {
			part.state.output = "[purged cascade: depends on purged work]";
		}
		purgedNow.add(call);
		purged++;

		// Purging `call` may complete the dependency count of the calls it
		// depends on, so they can be peeled next.
		for (const other of dependsOn.get(call) ?? []) {
			if (purgedCallIds.has(other) || purgedNow.has(other)) continue;
			const n = pending.get(other);
			if (n === undefined) continue;
			pending.set(other, n - 1);
			if (n - 1 === 0) queue.push(other);
		}
	}

	return purged;
}
