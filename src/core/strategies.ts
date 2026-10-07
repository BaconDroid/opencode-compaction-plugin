/**
 * Context optimization strategies for opencode-live-compaction.
 *
 * - Deduplication: removes duplicate tool calls (same tool + same args), keeping only the latest.
 * - Error purge: strips input content from errored tool calls after N turns.
 *
 * Both strategies operate on the messages array in experimental.chat.messages.transform.
 */

import type { LiveCompactionConfig } from "../config/config.js";
import { partInput } from "./messages.js";
import type { Message, MessagePart } from "../types.js";

export interface StrategyContext {
	/** The config for this session */
	config: LiveCompactionConfig;
	/** Per-session turn counter (incremented per message transform) */
	turnCounter: Map<string, number>;
	/** Session ID for turn tracking (set from the transform hook) */
	sessionId?: string;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Build a stable hash key for a tool call (tool name + serialized args).
 * Uses JSON.stringify with sorted keys for determinism.
 */
export function toolCallKey(tool: string, args: unknown): string {
	const sorted =
		typeof args === "object" && args !== null
			? sortKeys(args as Record<string, unknown>)
			: args;
	return `${tool}::${JSON.stringify(sorted)}`;
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort()) {
		const val = obj[key];
		sorted[key] =
			typeof val === "object" && val !== null && !Array.isArray(val)
				? sortKeys(val as Record<string, unknown>)
				: val;
	}
	return sorted;
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
	config: LiveCompactionConfig,
): number {
	if (!config.dedup?.enabled) return 0;

	const protectedTools = new Set(config.dedup.protectedTools ?? []);

	// Collect all tool call keys and their positions (in order)
	const seen = new Map<string, { msgIdx: number; partIdx: number }[]>();

	for (let mi = 0; mi < messages.length; mi++) {
		const msg = messages[mi];
		for (let pi = 0; pi < msg.parts.length; pi++) {
			const part = msg.parts[pi];
			if (part.type !== "tool" || !part.tool) continue;
			if (protectedTools.has(part.tool)) continue;
			// Only completed tool parts have an output to dedup; error states
			// carry `error`, not `output`.
			if (typeof part.state?.output !== "string") continue;

			const key = toolCallKey(part.tool, partInput(part));

			if (!seen.has(key)) seen.set(key, []);
			seen.get(key)!.push({ msgIdx: mi, partIdx: pi });
		}
	}

	let deduped = 0;

	for (const [_key, positions] of seen) {
		if (positions.length <= 1) continue;

		// Keep the last occurrence, replace earlier ones with a marker
		for (let i = 0; i < positions.length - 1; i++) {
			const { msgIdx, partIdx } = positions[i];
			const part = messages[msgIdx].parts[partIdx];
			if (part.state) {
				const originalLen = (part.state.output ?? "").length;
				part.state.output = `[deduped: same call as later ${part.tool} output — ${originalLen} chars removed]`;
			}
			deduped++;
		}
	}

	return deduped;
}

// ---------------------------------------------------------------------------
// Error Purge
// ---------------------------------------------------------------------------

/**
 * Find tool parts that returned errors and whose input should be purged.
 * Returns indices of parts whose input will be stripped.
 */
export function findErroredParts(
	messages: Message[],
): { msgIdx: number; partIdx: number }[] {
	const errored: { msgIdx: number; partIdx: number }[] = [];

	for (let mi = 0; mi < messages.length; mi++) {
		const msg = messages[mi];
		for (let pi = 0; pi < msg.parts.length; pi++) {
			const part = msg.parts[pi];
			if (part.type !== "tool" || !part.state) continue;

			const status = part.state.status;
			if (status === "error") {
				errored.push({ msgIdx: mi, partIdx: pi });
			}
		}
	}

	return errored;
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
	config: LiveCompactionConfig,
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
		const input = state.input;
		if (input === undefined || input === null) continue;

		// Real tool parts carry `state.input` as an object; a string is kept for
		// compatibility with older payloads.
		const inputLen =
			typeof input === "string" ? input.length : JSON.stringify(input).length;
		if (inputLen > 100) {
			state.input = { purged: `${inputLen} chars of errored input removed` };
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

/**
 * Purge work that depends on already-purged tool calls.
 *
 * Dependencies are derived deterministically from the tool inputs: a part
 * depends on a call when its serialized input references that call's `callID`.
 * A contaminated part is purged only once every part that depends on it has
 * been purged (reverse topological order), so the message graph stays coherent.
 *
 * Returns the number of parts purged.
 */
export function applyCascadePurge(
	messages: Message[],
	purgedCallIds: Set<string>,
	protectedIndices?: Set<number>,
): number {
	if (purgedCallIds.size === 0) return 0;

	// Index tool parts by callID.
	const partsByCall = new Map<string, { msgIdx: number; partIdx: number }>();
	for (let mi = 0; mi < messages.length; mi++) {
		for (let pi = 0; pi < messages[mi].parts.length; pi++) {
			const part = messages[mi].parts[pi];
			if (part.type === "tool" && typeof part.callID === "string") {
				partsByCall.set(part.callID, { msgIdx: mi, partIdx: pi });
			}
		}
	}

	// reverseDeps: callID -> calls that reference it (its dependents).
	const reverseDeps = new Map<string, Set<string>>();
	for (const [call, pos] of partsByCall) {
		const inputText = serializeInput(messages[pos.msgIdx].parts[pos.partIdx]);
		if (!inputText) continue;
		for (const other of partsByCall.keys()) {
			if (other === call) continue;
			if (inputText.includes(other)) {
				// `call` depends on `other`: record `call` as a dependent of `other`.
				let deps = reverseDeps.get(other);
				if (!deps) {
					deps = new Set();
					reverseDeps.set(other, deps);
				}
				deps.add(call);
			}
		}
	}

	// Descendants of the purged work (transitive closure over dependents).
	const contaminated = new Set<string>();
	const stack = [...purgedCallIds];
	while (stack.length > 0) {
		const call = stack.pop() as string;
		for (const dep of reverseDeps.get(call) ?? []) {
			if (!contaminated.has(dep) && !purgedCallIds.has(dep)) {
				contaminated.add(dep);
				stack.push(dep);
			}
		}
	}

	// Purge leaves first: a part is purgeable only when all its dependents are
	// already purged. Iterate to a fixpoint.
	const purgedNow = new Set<string>();
	let purged = 0;
	let changed = true;
	while (changed) {
		changed = false;
		for (const call of contaminated) {
			if (purgedNow.has(call)) continue;
			const dependents = reverseDeps.get(call) ?? new Set<string>();
			const allPurged = [...dependents].every(
				(dep) => purgedCallIds.has(dep) || purgedNow.has(dep),
			);
			if (!allPurged) continue;

			const pos = partsByCall.get(call);
			if (!pos) continue;
			if (protectedIndices?.has(pos.msgIdx)) continue;

			const part = messages[pos.msgIdx].parts[pos.partIdx];
			if (part.state) {
				part.state.input = { purged: "cascade: depends on purged work" };
				part.state.output =
					"[purged cascade: depends on purged work]";
			}
			purgedNow.add(call);
			purged++;
			changed = true;
		}
	}

	return purged;
}
