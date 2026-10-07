/**
 * Preemptive (proactive) compaction logic for opencode-live-compaction.
 *
 * Compaction is normally triggered by OpenCode when the context is full. When
 * enabled, this triggers it earlier, once the reported token usage reaches a
 * fraction of the model's context limit, so the session is compacted before it
 * overflows.
 *
 * The decision is a pure function so it can be tested without a client.
 */

export interface TokenInfo {
	input?: number;
	output?: number;
	reasoning?: number;
	cache?: { read?: number; write?: number };
}

export interface CachedUsage {
	providerID: string;
	modelID: string;
	tokens: TokenInfo;
}

/**
 * Effective tokens used to decide preemptive compaction.
 *
 * Cache reads/writes can inflate the reported usage and trigger compaction
 * prematurely, so they are excluded unless `countCacheTokens` is true. When
 * enabled, the value mirrors `opencode-context-compress`: `total` when present,
 * otherwise `input + output + reasoning + cache.read + cache.write`.
 */
export function effectiveInputTokens(
	tokens: TokenInfo,
	countCacheTokens: boolean,
): number {
	const base =
		(tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0);
	const cache = (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
	return countCacheTokens ? base + cache : base;
}

/** Config subset needed to resolve the hybrid trigger threshold. */
export interface TriggerThresholdConfig {
	threshold: number;
	absoluteTokenThreshold?: number;
}

/**
 * Resolve the compaction trigger threshold in tokens: the smaller of the
 * ratio-based threshold (`floor(contextLimit * threshold)`) and an optional
 * absolute ceiling.
 */
export function resolveTriggerThreshold(
	contextLimit: number,
	cfg: TriggerThresholdConfig,
): number {
	const relative = Math.floor(contextLimit * cfg.threshold);
	if (
		typeof cfg.absoluteTokenThreshold === "number" &&
		cfg.absoluteTokenThreshold > 0
	) {
		return Math.min(relative, cfg.absoluteTokenThreshold);
	}
	return relative;
}

export interface TriggerGateInput {
	/** Config gate: minimum new tokens since the last compaction (0 disables). */
	minTokensSinceLast?: number;
	/** Config gate: minimum new messages since the last compaction (0 disables). */
	minMessagesSinceLast?: number;
	/** Measured new tokens since the last compaction (undefined = unknown). */
	tokensSinceLast?: number;
	/** Measured new messages since the last compaction. */
	messagesSinceLast?: number;
	/** Config gate: do not compact until enough new tool calls accumulated. */
	tailGuard?: { enabled?: boolean; minNewToolCalls?: number };
	/** Measured new tool calls since the last compaction. */
	newToolCallsSinceLast?: number;
}

export function shouldTriggerPreemptiveCompaction(
	input: {
		totalInputTokens: number;
		contextLimit: number;
		threshold: number;
		/** Absolute token threshold; when set it replaces the ratio comparison. */
		thresholdTokens?: number;
		cooldownMs: number;
		now: number;
		lastCompactionAt?: number;
		inProgress: boolean;
	} & TriggerGateInput,
): boolean {
	if (input.inProgress) return false;
	if (!Number.isFinite(input.contextLimit) || input.contextLimit <= 0) return false;
	if (
		input.lastCompactionAt !== undefined &&
		input.now - input.lastCompactionAt < input.cooldownMs
	) {
		return false;
	}
	// Deterministic gates (composition AND, cf. selfcompact).
	if (
		input.minTokensSinceLast &&
		(input.tokensSinceLast ?? Number.POSITIVE_INFINITY) <
			input.minTokensSinceLast
	) {
		return false;
	}
	if (
		input.minMessagesSinceLast &&
		(input.messagesSinceLast ?? Number.POSITIVE_INFINITY) <
			input.minMessagesSinceLast
	) {
		return false;
	}
	if (
		input.tailGuard?.enabled &&
		(input.newToolCallsSinceLast ?? 0) < (input.tailGuard.minNewToolCalls ?? 0)
	) {
		return false;
	}
	if (input.thresholdTokens !== undefined) {
		return input.totalInputTokens >= input.thresholdTokens;
	}
	return input.totalInputTokens / input.contextLimit >= input.threshold;
}
