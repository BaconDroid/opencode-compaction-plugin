/**
 * Graduated, LLM-free eviction for opencode-live-compaction.
 *
 * When the estimated token budget is exceeded, evict content in a deterministic
 * order — reasoning, intermediate text, then whole episodes — oldest first
 * (`bulk_output` is opt-in and off by default, being redundant with trimming).
 * User turns and the prologue are never evicted.
 */

import { blockId, type BlockMessage } from "./blocks.js";
import { EVICTED_BULK_SUFFIX } from "./markers.js";

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
	/** Message indices never evicted (e.g. pinned constraints). */
	protectedIndices?: Set<number>;
	/**
	 * Opaque token estimator. Kept for callers that only have a black-box
	 * estimate; when supplied without `resolveText`, eviction re-estimates the
	 * whole array after each change (O(n²)). Prefer `resolveText`, which lets
	 * eviction maintain the running total exactly in O(n).
	 */
	estimate?: (messages: BlockMessage[]) => number;
	/**
	 * Optional per-text token resolver (e.g. a scorer adapter, E5). When set,
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
	"intermediate",
	"episode",
];

const BULK_OUTPUT_LIMIT = 200;
const EPISODE_MARKER = "[evicted episode]";
const REASONING_MARKER = "[evicted reasoning]";
const INTERMEDIATE_MARKER = "[evicted intermediate]";

/**
 * Rough token estimate (4 chars ≈ 1 token) over text, outputs and inputs.
 *
 * `resolveText` optionally overrides the estimate for a given text (e.g. a
 * scorer adapter, E5); unresolved texts keep the chars ÷ 4 heuristic.
 */
export function estimateTokens(
	messages: BlockMessage[],
	resolveText?: (text: string) => number | undefined,
): number {
	const totals = measureMessages(messages, resolveText);
	return Math.ceil(totals.chars / 4) + totals.tokens;
}

/** Raw char/token totals under the same accounting as `estimateTokens`. */
interface TokenTotals {
	chars: number;
	tokens: number;
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
		else chars += part.text.length;
	}
	const state = (part as { state?: { output?: unknown; input?: unknown } })
		.state;
	if (state && typeof state.output === "string") {
		chars += state.output.length;
	}
	if (state && state.input !== undefined && state.input !== null) {
		chars +=
			typeof state.input === "string"
				? state.input.length
				: JSON.stringify(state.input).length;
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

/** Returns true when something was evicted (so the budget can be re-checked). */
function evictReasoning(message: BlockMessage, result: EvictionResult): boolean {
	let changed = false;
	for (const part of message.parts ?? []) {
		if (
			(part.type === "reasoning" || part.type === "thinking") &&
			typeof part.text === "string" &&
			part.text.length > 0 &&
			part.text !== REASONING_MARKER
		) {
			part.text = REASONING_MARKER;
			result.removed++;
			result.evictedIds.push(blockId(message));
			changed = true;
		}
	}
	return changed;
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
	let changed = false;
	for (const part of message.parts ?? []) {
		if (
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0 &&
			part.text !== INTERMEDIATE_MARKER
		) {
			part.text = INTERMEDIATE_MARKER;
			result.removed++;
			result.evictedIds.push(blockId(message));
			changed = true;
		}
	}
	return changed;
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

	// Exact path: maintain the running char/token totals in O(n) using the same
	// accounting as `estimateTokens` (so a scorer's per-text resolver is honoured
	// without re-scanning the whole array after every change). The opaque
	// `estimate`-only path is kept for callers that cannot provide a resolver.
	const exact = !cfg.estimate || cfg.resolveText !== undefined;
	let totals: TokenTotals | undefined = exact
		? measureMessages(messages, cfg.resolveText)
		: undefined;
	const budgetReached = (): boolean => {
		if (totals) return Math.ceil(totals.chars / 4) + totals.tokens <= cfg.thresholdTokens;
		return (cfg.estimate as (m: BlockMessage[]) => number)(messages) <= cfg.thresholdTokens;
	};
	if (budgetReached()) return result;

	const levels = cfg.levels ?? DEFAULT_LEVELS;
	const prologueEnd = cfg.protectPrologue === false ? 0 : 1;
	const isProtected = (index: number): boolean =>
		index < prologueEnd ||
		messages[index]?.info?.role === "user" ||
		cfg.protectedIndices?.has(index) === true;

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
			const before = totals
				? measureMessage(messages[i], cfg.resolveText)
				: undefined;
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
			if (before && totals) {
				const after = measureMessage(messages[i], cfg.resolveText);
				totals.chars -= before.chars - after.chars;
				totals.tokens -= before.tokens - after.tokens;
			}
			if (budgetReached()) break;
		}
	}

	return result;
}
