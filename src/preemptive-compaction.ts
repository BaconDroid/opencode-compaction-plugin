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

/** Effective prompt tokens used against the context window. */
export function totalInputTokens(tokens: TokenInfo): number {
	return (tokens.input ?? 0) + (tokens.cache?.read ?? 0);
}

export function shouldTriggerPreemptiveCompaction(input: {
	totalInputTokens: number;
	contextLimit: number;
	threshold: number;
	cooldownMs: number;
	now: number;
	lastCompactionAt?: number;
	inProgress: boolean;
}): boolean {
	if (input.inProgress) return false;
	if (!Number.isFinite(input.contextLimit) || input.contextLimit <= 0) return false;
	if (
		input.lastCompactionAt !== undefined &&
		input.now - input.lastCompactionAt < input.cooldownMs
	) {
		return false;
	}
	return input.totalInputTokens / input.contextLimit >= input.threshold;
}
