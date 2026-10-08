/**
 * Graduated, LLM-free eviction for opencode-live-compaction.
 *
 * When the estimated token budget is exceeded, evict content in a deterministic
 * order — reasoning, bulk tool output, intermediate text, then whole episodes —
 * oldest first. User turns and the prologue are never evicted.
 */

import { blockId, type BlockMessage } from "./blocks.js";

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
	 * Token estimator; defaults to the heuristic `estimateTokens`. An optional
	 * scorer adapter supplies a calibrated estimator (E5).
	 */
	estimate?: (messages: BlockMessage[]) => number;
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
	let chars = 0;
	let tokens = 0;
	for (const message of messages) {
		for (const part of message.parts ?? []) {
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
		}
	}
	return Math.ceil(chars / 4) + tokens;
}

function evictReasoning(message: BlockMessage, result: EvictionResult): void {
	for (const part of message.parts ?? []) {
		if (
			(part.type === "reasoning" || part.type === "thinking") &&
			typeof part.text === "string" &&
			part.text.length > 0
		) {
			part.text = REASONING_MARKER;
			result.removed++;
			result.evictedIds.push(blockId(message));
		}
	}
}

function evictBulkOutput(message: BlockMessage, result: EvictionResult): void {
	for (const part of message.parts ?? []) {
		const state = (part as { state?: { output?: unknown } }).state;
		if (
			part.type === "tool" &&
			state &&
			typeof state.output === "string" &&
			state.output.length > BULK_OUTPUT_LIMIT
		) {
			state.output =
				state.output.slice(-BULK_OUTPUT_LIMIT) +
				"\n... [evicted bulk output]";
			result.removed++;
			result.evictedIds.push(
				typeof part.callID === "string" ? `r:${part.callID}` : blockId(message),
			);
		}
	}
}

function evictIntermediate(
	message: BlockMessage,
	result: EvictionResult,
	lastAssistantIndex: number,
	index: number,
): void {
	// Keep the most recent assistant message intact.
	if (index >= lastAssistantIndex) return;
	for (const part of message.parts ?? []) {
		if (
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0
		) {
			part.text = INTERMEDIATE_MARKER;
			result.removed++;
			result.evictedIds.push(blockId(message));
		}
	}
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
	const estimate = cfg.estimate ?? estimateTokens;
	if (estimate(messages) <= cfg.thresholdTokens) return result;

	const levels = cfg.levels ?? DEFAULT_LEVELS;
	const prologueEnd = cfg.protectPrologue === false ? 0 : 1;
	const budgetReached = (): boolean =>
		estimate(messages) <= cfg.thresholdTokens;
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

		if (level === "episode") {
			// Oldest assistant tool episodes first.
			for (let i = 0; i < messages.length; i++) {
				if (budgetReached()) break;
				if (isProtected(i)) continue;
				evictEpisode(messages[i], result);
			}
			continue;
		}

		for (let i = 0; i < messages.length; i++) {
			if (budgetReached()) break;
			if (isProtected(i)) continue;
			if (level === "reasoning") {
				evictReasoning(messages[i], result);
			} else if (level === "bulk_output") {
				evictBulkOutput(messages[i], result);
			} else if (level === "intermediate") {
				evictIntermediate(messages[i], result, lastAssistantIndex, i);
			}
		}
	}

	return result;
}
