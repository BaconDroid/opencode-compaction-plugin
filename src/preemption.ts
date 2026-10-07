/**
 * Proactive (preemptive) compaction: the pure trigger logic plus the controller
 * that owns the per-session usage cache, the deterministic gate counters and the
 * context-limit cache, and decides when to call `session.summarize`. Also gates
 * the model-driven `compress` tool on the same usage signal.
 */

import type { ResolvedConfig } from "./config.js";
import type { Logger } from "./types.js";
import type { PluginInput } from "./types.js";

// ---------------------------------------------------------------------------
// Pure trigger logic (testable without a client)
// ---------------------------------------------------------------------------

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
 * enabled the value is `input + output + reasoning + cache.read + cache.write`.
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
	if (!Number.isFinite(input.contextLimit) || input.contextLimit <= 0) {
		return false;
	}
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

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class PreemptionController {
	private usage = new Map<string, CachedUsage>();
	private inProgress = new Set<string>();
	private last = new Map<string, number>();
	// Counters since the last proactive compaction (deterministic gates).
	private tokensAtLast = new Map<string, number>();
	private toolCallsSince = new Map<string, number>();
	private messagesSince = new Map<string, number>();
	private contextLimitCache = new Map<string, number>();

	constructor(
		private readonly client: PluginInput["client"],
		private readonly directory: string,
		private readonly config: ResolvedConfig,
		private readonly logger: Logger,
	) {}

	/** Count a tool call since the last compaction. */
	recordToolCall(sessionID: string): void {
		this.toolCallsSince.set(
			sessionID,
			(this.toolCallsSince.get(sessionID) ?? 0) + 1,
		);
	}

	/** Count a completed assistant turn since the last compaction. */
	recordMessage(sessionID: string): void {
		this.messagesSince.set(
			sessionID,
			(this.messagesSince.get(sessionID) ?? 0) + 1,
		);
	}

	recordUsage(
		sessionID: string,
		providerID: string,
		modelID: string,
		tokens: TokenInfo,
	): void {
		this.usage.set(sessionID, { providerID, modelID, tokens });
	}

	/**
	 * Eligibility gate for the model-driven `compress` tool: when proactive
	 * compaction is enabled, defer a compression requested far below the
	 * compaction threshold (deterministic, no model call). Manual use without
	 * preemptive compaction enabled is never gated.
	 */
	async isCompressEligible(sessionID: string): Promise<boolean> {
		const cfg = this.config.preemptiveCompaction;
		if (!cfg?.enabled) return true;
		const usage = this.usage.get(sessionID);
		if (!usage) return true;
		const limit = await this.resolveContextLimit(
			usage.providerID,
			usage.modelID,
		);
		if (limit === undefined) return true;
		const effective = effectiveInputTokens(
			usage.tokens,
			cfg.countCacheTokens ?? false,
		);
		return effective >= resolveTriggerThreshold(limit, cfg) * 0.5;
	}

	/** Trigger proactive compaction when the reported usage nears the limit. */
	async maybePreempt(sessionID: string): Promise<void> {
		const cfg = this.config.preemptiveCompaction;
		if (!cfg?.enabled) return;
		const usage = this.usage.get(sessionID);
		if (!usage) return;
		if (this.inProgress.has(sessionID)) return;

		const limit = await this.resolveContextLimit(
			usage.providerID,
			usage.modelID,
		);
		if (limit === undefined) return;

		const effectiveTokens = effectiveInputTokens(
			usage.tokens,
			cfg.countCacheTokens ?? false,
		);
		const thresholdTokens = resolveTriggerThreshold(limit, cfg);
		const baseline = this.tokensAtLast.get(sessionID);

		const trigger = shouldTriggerPreemptiveCompaction({
			totalInputTokens: effectiveTokens,
			contextLimit: limit,
			threshold: cfg.threshold,
			thresholdTokens,
			minTokensSinceLast: cfg.minTokensSinceLast,
			minMessagesSinceLast: cfg.minMessagesSinceLast,
			tokensSinceLast:
				baseline === undefined
					? undefined
					: Math.max(0, effectiveTokens - baseline),
			messagesSinceLast: this.messagesSince.get(sessionID) ?? 0,
			tailGuard: cfg.tailGuard,
			newToolCallsSinceLast: this.toolCallsSince.get(sessionID) ?? 0,
			cooldownMs: cfg.cooldownMs,
			now: Date.now(),
			lastCompactionAt: this.last.get(sessionID),
			inProgress: false,
		});
		if (!trigger) return;

		const summarize = this.client.session?.summarize;
		if (!summarize) return;

		this.inProgress.add(sessionID);
		this.last.set(sessionID, Date.now());
		// Reset the deterministic gates for the next cycle.
		this.tokensAtLast.set(sessionID, effectiveTokens);
		this.toolCallsSince.set(sessionID, 0);
		this.messagesSince.set(sessionID, 0);
		try {
			await summarize({
				path: { id: sessionID },
				body: {
					providerID: usage.providerID,
					modelID: usage.modelID,
					auto: true,
				},
				query: { directory: this.directory },
			});
			this.logger.info("preemptive compaction triggered", {
				sessionID,
				ratio: effectiveTokens / limit,
			});
		} catch (error) {
			this.logger.info("preemptive compaction failed", {
				error: String(error),
			});
		} finally {
			this.inProgress.delete(sessionID);
		}
	}

	clear(sessionID: string): void {
		this.usage.delete(sessionID);
		this.inProgress.delete(sessionID);
		this.last.delete(sessionID);
		this.tokensAtLast.delete(sessionID);
		this.toolCallsSince.delete(sessionID);
		this.messagesSince.delete(sessionID);
	}

	clearAll(): void {
		this.usage.clear();
		this.inProgress.clear();
		this.last.clear();
		this.tokensAtLast.clear();
		this.toolCallsSince.clear();
		this.messagesSince.clear();
		this.contextLimitCache.clear();
	}

	// Resolve the model context limit: config override first, else the provider
	// catalog. Cached per provider/model.
	private async resolveContextLimit(
		providerID: string,
		modelID: string,
	): Promise<number | undefined> {
		const override = this.config.preemptiveCompaction?.contextLimit;
		if (typeof override === "number" && override > 0) return override;

		const key = `${providerID}/${modelID}`;
		const cached = this.contextLimitCache.get(key);
		if (cached !== undefined) return cached;

		const list = this.client.provider?.list;
		if (!list) return undefined;
		try {
			// The SDK wraps the body in `{ data }`; accept both shapes.
			const response = (await list({})) as {
				all?: Array<{
					id?: string;
					models?: Record<string, { limit?: { context?: number } }>;
				}>;
				data?: {
					all?: Array<{
						id?: string;
						models?: Record<string, { limit?: { context?: number } }>;
					}>;
				};
			};
			const providers = response?.data?.all ?? response?.all;
			const limit = providers?.find((p) => p.id === providerID)?.models?.[
				modelID
			]?.limit?.context;
			if (typeof limit === "number" && limit > 0) {
				this.contextLimitCache.set(key, limit);
				return limit;
			}
		} catch (error) {
			this.logger.info("context limit resolution failed", {
				error: String(error),
			});
		}
		return undefined;
	}
}
