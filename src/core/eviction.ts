/**
 * Graduated, LLM-free eviction for opencode-compaction-plugin.
 *
 * When the estimated token budget is exceeded, evict content in a deterministic
 * order — reasoning, bulk tool output, intermediate text, then whole episodes —
 * oldest first. User turns and the prologue are never evicted.
 */

import { blockId, type BlockMessage } from "./blocks.js";
import {
	EPISODE_MARKER,
	EVICTED_BULK_SUFFIX,
	INTERMEDIATE_MARKER,
	REASONING_MARKER,
} from "./markers.js";

export type EvictionLevel =
	| "reasoning"
	| "bulk_output"
	| "intermediate"
	| "episode";

export interface EvictionConfig {
	enabled: boolean;
	/** Token budget; eviction runs only when the estimate exceeds it. */
	thresholdTokens: number;
	/** Levels to apply, in order (defaults to all four). */
	levels?: EvictionLevel[];
	/** Protect the first message (prologue) from eviction (default: true). */
	protectPrologue?: boolean;
	/**
	 * Optional per-text token resolver (e.g. a scorer adapter). When set,
	 * eviction tracks the exact char/token totals itself using the same
	 * accounting as `estimateTokens` (including this resolver), so tool outputs
	 * and unscored texts keep the heuristic.
	 */
	resolveText?: (text: string) => number | undefined;
}

export interface EvictionResult {
	/** Number of parts/messages evicted. */
	removed: number;
	/** Durable ids of the evicted content. */
	evictedIds: string[];
}

const DEFAULT_LEVELS: EvictionLevel[] = [
	"reasoning",
	"bulk_output",
	"intermediate",
	"episode",
];

const BULK_OUTPUT_LIMIT = 200;

/**
 * Scripts that are roughly one token per character (CJK and the space-less
 * Southeast Asian scripts), unlike Latin text at ~4 characters per token.
 */
const WIDE_CHAR =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

/**
 * Length of `text` in "weighted characters": a wide (CJK) character counts as
 * four, so the shared `ceil(chars / 4)` rule yields ~1 token per wide character
 * while keeping the Latin rule of thumb (~4 characters per token).
 */
function weightedLength(text: string): number {
	const wide = text.length - text.replace(WIDE_CHAR, "").length;
	return text.length + wide * 3;
}

/**
 * Rough token estimate (4 chars ≈ 1 token) over text, outputs and inputs. Wide
 * (CJK) characters are weighted as ~1 token each rather than a quarter.
 *
 * `resolveText` optionally overrides the estimate for a given text (e.g. a
 * scorer adapter); unresolved texts keep the heuristic.
 */
export function estimateTokens(
	messages: BlockMessage[],
	resolveText?: (text: string) => number | undefined,
): number {
	return totalTokens(measureMessages(messages, resolveText));
}

/** Raw char/token totals under the same accounting as `estimateTokens`. */
interface TokenTotals {
	chars: number;
	tokens: number;
}

/** Collapse char/token totals into the token estimate. */
function totalTokens(totals: TokenTotals): number {
	return Math.ceil(totals.chars / 4) + totals.tokens;
}

/** Contribution of a single part, mirroring `estimateTokens` exactly. */
function measurePart(
	part: BlockMessage["parts"][number],
	resolveText?: (text: string) => number | undefined,
): TokenTotals {
	let chars = 0;
	let tokens = 0;
	if (typeof part.text === "string") {
		const scored = resolveText?.(part.text);
		if (scored !== undefined) tokens += scored;
		else chars += weightedLength(part.text);
	}
	const state = (part as { state?: { output?: unknown; input?: unknown } })
		.state;
	if (state && typeof state.output === "string") {
		chars += weightedLength(state.output);
	}
	if (state && state.input !== undefined && state.input !== null) {
		chars += weightedLength(
			typeof state.input === "string"
				? state.input
				: JSON.stringify(state.input),
		);
	}
	return { chars, tokens };
}

/** Contribution of a single message (sum of its parts). */
function measureMessage(
	message: BlockMessage,
	resolveText?: (text: string) => number | undefined,
): TokenTotals {
	let chars = 0;
	let tokens = 0;
	for (const part of message.parts ?? []) {
		const totals = measurePart(part, resolveText);
		chars += totals.chars;
		tokens += totals.tokens;
	}
	return { chars, tokens };
}

/** Contribution of an array of messages. */
function measureMessages(
	messages: BlockMessage[],
	resolveText?: (text: string) => number | undefined,
): TokenTotals {
	let chars = 0;
	let tokens = 0;
	for (const message of messages) {
		const totals = measureMessage(message, resolveText);
		chars += totals.chars;
		tokens += totals.tokens;
	}
	return { chars, tokens };
}

/** Replace the text of matching parts with `marker`; true if anything changed. */
function evictTextParts(
	message: BlockMessage,
	types: readonly string[],
	marker: string,
	result: EvictionResult,
): boolean {
	let changed = false;
	for (const part of message.parts ?? []) {
		if (
			types.includes(part.type ?? "") &&
			typeof part.text === "string" &&
			part.text.length > 0 &&
			part.text !== marker
		) {
			part.text = marker;
			result.removed++;
			result.evictedIds.push(blockId(message));
			changed = true;
		}
	}
	return changed;
}

function evictReasoning(message: BlockMessage, result: EvictionResult): boolean {
	return evictTextParts(message, ["reasoning", "thinking"], REASONING_MARKER, result);
}

function evictBulkOutput(message: BlockMessage, result: EvictionResult): boolean {
	let changed = false;
	for (const part of message.parts ?? []) {
		const state = (part as { state?: { output?: unknown } }).state;
		if (
			part.type === "tool" &&
			state &&
			typeof state.output === "string" &&
			// Only evict when the result is actually shorter (never enlarge).
			state.output.length > BULK_OUTPUT_LIMIT + EVICTED_BULK_SUFFIX.length &&
			!state.output.endsWith(EVICTED_BULK_SUFFIX)
		) {
			state.output = state.output.slice(-BULK_OUTPUT_LIMIT) + EVICTED_BULK_SUFFIX;
			result.removed++;
			result.evictedIds.push(
				typeof part.callID === "string" ? `r:${part.callID}` : blockId(message),
			);
			changed = true;
		}
	}
	return changed;
}

function evictIntermediate(
	message: BlockMessage,
	result: EvictionResult,
	lastAssistantIndex: number,
	index: number,
): boolean {
	// Keep the most recent assistant message intact.
	if (index >= lastAssistantIndex) return false;
	return evictTextParts(message, ["text"], INTERMEDIATE_MARKER, result);
}

function evictEpisode(message: BlockMessage, result: EvictionResult): boolean {
	const hasTool = (message.parts ?? []).some((part) => part.type === "tool");
	if (!hasTool) return false;
	const id = blockId(message);
	message.parts = [{ type: "text", text: EPISODE_MARKER }];
	result.removed++;
	result.evictedIds.push(id);
	return true;
}

/**
 * Apply graduated eviction in place. Returns what was evicted. Stops as soon as
 * the estimated token count falls to or below `thresholdTokens`.
 */
export function applyEviction(
	messages: BlockMessage[],
	cfg: EvictionConfig,
): EvictionResult {
	const result: EvictionResult = { removed: 0, evictedIds: [] };
	if (!cfg.enabled) return result;

	// Maintain the running char/token totals in O(n) using the same accounting
	// as `estimateTokens`, so a scorer's per-text resolver is honoured without
	// re-scanning the whole array after every change.
	const totals = measureMessages(messages, cfg.resolveText);
	const budgetReached = (): boolean =>
		totalTokens(totals) <= cfg.thresholdTokens;
	if (budgetReached()) return result;

	const levels = cfg.levels ?? DEFAULT_LEVELS;
	const prologueEnd = cfg.protectPrologue === false ? 0 : 1;
	const isProtected = (index: number): boolean =>
		index < prologueEnd || messages[index]?.info?.role === "user";

	let lastAssistantIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].info?.role === "assistant") {
			lastAssistantIndex = i;
			break;
		}
	}

	for (const level of levels) {
		if (budgetReached()) break;

		for (let i = 0; i < messages.length; i++) {
			if (isProtected(i)) continue;
			const before = measureMessage(messages[i], cfg.resolveText);
			let changed = false;
			if (level === "episode") {
				changed = evictEpisode(messages[i], result);
			} else if (level === "reasoning") {
				changed = evictReasoning(messages[i], result);
			} else if (level === "bulk_output") {
				changed = evictBulkOutput(messages[i], result);
			} else if (level === "intermediate") {
				changed = evictIntermediate(messages[i], result, lastAssistantIndex, i);
			}
			if (!changed) continue;
			const after = measureMessage(messages[i], cfg.resolveText);
			totals.chars -= before.chars - after.chars;
			totals.tokens -= before.tokens - after.tokens;
			if (budgetReached()) break;
		}
	}

	return result;
}
