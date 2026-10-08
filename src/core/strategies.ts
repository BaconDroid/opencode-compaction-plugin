/**
 * Context optimization strategies for opencode-live-compaction.
 *
 * - Deduplication: removes duplicate tool calls (same tool + same args), keeping only the latest.
 * - Error purge: strips input content from errored tool calls after N turns.
 *
 * Both strategies operate on the messages array in experimental.chat.messages.transform.
 */

import type { LiveCompactionConfig } from "../config/config.js";
import { DEDUPED_PREFIX } from "./markers.js";
import { partInput, setPartInput } from "./messages.js";
import type { Message, MessagePart } from "../types.js";

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Build a stable hash key for a tool call (tool name + serialized args).
 * Uses JSON.stringify with sorted keys for determinism.
 */
export function toolCallKey(tool: string, args: unknown): string {
	const sorted =
		typeof args === "object" && args !== null ? sortKeys(args) : args;
	return `${tool}::${JSON.stringify(sorted)}`;
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
	config: LiveCompactionConfig,
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

			if (!seen.has(key)) seen.set(key, []);
			seen.get(key)!.push({ msgIdx: mi, partIdx: pi });
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

/**
 * True when `text` references `id` as a whole token, not as a substring of a
 * longer id (so purging `abc` does not drag in work that only mentioned
 * `abcdef`).
 */
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

	// reverseDeps: callID -> calls that reference it (its dependents).
	const reverseDeps = new Map<string, Set<string>>();
	for (const [call, pos] of partsByCall) {
		const inputText = serializeInput(messages[pos.msgIdx].parts[pos.partIdx]);
		if (!inputText) continue;
		for (const other of partsByCall.keys()) {
			if (other === call) continue;
			if (referencesCall(inputText, other)) {
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
			let allPurged = true;
			for (const dep of reverseDeps.get(call) ?? []) {
				if (!purgedCallIds.has(dep) && !purgedNow.has(dep)) {
					allPurged = false;
					break;
				}
			}
			if (!allPurged) continue;

			const pos = partsByCall.get(call);
			if (!pos) continue;
			if (protectedIndices?.has(pos.msgIdx)) continue;

			const part = messages[pos.msgIdx].parts[pos.partIdx];
			setPartInput(part, { purged: "cascade: depends on purged work" });
			if (part.state) {
				part.state.output = "[purged cascade: depends on purged work]";
			}
			purgedNow.add(call);
			purged++;
			changed = true;
		}
	}

	return purged;
}
