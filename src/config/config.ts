/**
 * Configuration model for opencode-live-compaction: types, defaults and the
 * merge over defaults. File loading lives in `config-loader.ts`.
 */

import type { EvictionLevel } from "../core/eviction.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DedupConfig {
	/** Enable deduplication of repeated tool calls (default: true) */
	enabled?: boolean;
	/** Tool names to exclude from dedup (default: []) */
	protectedTools?: string[];
}

export interface PurgeErrorsConfig {
	/** Enable purging errored tool inputs (default: true) */
	enabled?: boolean;
	/** Number of turns after which to purge error inputs (default: 4) */
	turns?: number;
	/**
	 * Purge the whole failed attempt (input + output) instead of only the input.
	 * The error output is replaced by a compact extract (default: true)
	 */
	wholeAttempt?: boolean;
	/**
	 * Cascade the purge to work that depends on a purged call (default: true)
	 */
	cascade?: boolean;
}

export interface CompressConfig {
	/** Trailing user turns protected from deterministic span selection (default: 3) */
	protectedTurns?: number;
	/** Keep compressed originals in memory for expand (default: false) */
	reversible?: boolean;
	/** Maximum hits returned by the `search` tool (default: 5) */
	searchMaxResults?: number;
}

export interface EvictionSettings {
	/** Enable graduated LLM-free eviction (default: true) */
	enabled?: boolean;
	/** Token budget; eviction runs only above it (default: 200000) */
	thresholdTokens?: number;
	/** Levels to apply, in order (default: reasoning, bulk_output, intermediate, episode) */
	levels?: EvictionLevel[];
	/** Protect the prologue from eviction (default: true) */
	protectPrologue?: boolean;
}

export interface PreemptiveCompactionConfig {
	/** Compact proactively before the context overflows (default: false) */
	enabled?: boolean;
	/** Fraction of the context limit that triggers compaction (default: 0.80) */
	threshold?: number;
	/** Absolute token ceiling for the trigger; the smaller of ratio and this wins */
	absoluteTokenThreshold?: number;
	/** Count cache read/write tokens in the usage (default: true) */
	countCacheTokens?: boolean;
	/** Minimum new tokens since the last compaction before compacting (default: 0) */
	minTokensSinceLast?: number;
	/** Minimum delay between proactive compactions, in ms (default: 60000) */
	cooldownMs?: number;
	/** Override the model context limit (otherwise resolved from the provider) */
	contextLimit?: number;
}

/** Transport for an optional external adapter. */
export type AdapterProvider = "http" | "command" | "mcp";

/**
 * Fields shared by every optional adapter. Opt-in: an adapter is disabled
 * unless its block is present. Providers talk to an existing endpoint/command;
 * no SDK or model is bundled.
 */
export interface AdapterTransportConfig {
	/** Enable the adapter (default: true when the block is present) */
	enabled?: boolean;
	/** Transport: `http` (default), `command`, or `mcp` (not yet supported) */
	provider?: AdapterProvider;
	/** Endpoint URL (required for provider "http") */
	url?: string;
	/** Shell command (required for provider "command"); see README for the contract */
	command?: string;
	/** Optional model/identifier forwarded to the provider */
	model?: string;
	/** Request timeout in ms (default: 10000) */
	timeoutMs?: number;
}

/**
 * Optional semantic embedding/retrieval adapter (E2/E3/E4).
 */
export interface EmbeddingsAdapterConfig extends AdapterTransportConfig {
	/** Minimum cosine score for a semantic hit (default: 0) */
	minScore?: number;
}

/**
 * Optional residual/perplexity scorer adapter (E5/E9). Refines the eviction
 * budget estimate; absent → heuristic.
 */
export interface ScorerAdapterConfig extends AdapterTransportConfig {
	/** Maximum distinct texts scored per transform (default: 200) */
	maxSamples?: number;
}

/** Optional external adapters (all off by default). */
export interface AdaptersConfig {
	/** Semantic embedding/retrieval adapter */
	embeddings?: EmbeddingsAdapterConfig;
	/** Residual/perplexity scorer adapter (eviction budget) */
	scorer?: ScorerAdapterConfig;
}

export interface DegradationMonitorConfig {
	/** Enable the post-compaction degradation diagnostic (default: false) */
	enabled?: boolean;
	/** Consecutive assistant messages without text that trigger a warning (default: 4) */
	threshold?: number;
	/** Window after compaction during which the check runs, in ms (default: 120000) */
	windowMs?: number;
}

export interface LiveCompactionConfig {
	/** Enable/disable the entire plugin (default: true) */
	enabled?: boolean;
	/** Deduplication strategy */
	dedup?: DedupConfig;
	/** Error input purging strategy */
	purgeErrors?: PurgeErrorsConfig;
	/** Model-driven compress tool settings */
	compress?: CompressConfig;
	/** Graduated, LLM-free eviction */
	eviction?: EvictionSettings;
	/** Proactive compaction before the context overflows */
	preemptiveCompaction?: PreemptiveCompactionConfig;
	/** How the compaction prompt is applied: replace the default or augment it (default: "replace") */
	promptMode?: "replace" | "augment";
	/** Post-compaction degradation diagnostic */
	degradationMonitor?: DegradationMonitorConfig;
	/** Optional external adapters (semantic retrieval, scorer) */
	adapters?: AdaptersConfig;
	/** Enable debug logging (default: false) */
	debug?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Required<
	Omit<
		LiveCompactionConfig,
		| "dedup"
		| "purgeErrors"
		| "compress"
		| "eviction"
		| "preemptiveCompaction"
		| "degradationMonitor"
		| "adapters"
	>
> & {
	dedup: Required<DedupConfig>;
	purgeErrors: Required<PurgeErrorsConfig>;
	compress: Required<CompressConfig>;
	eviction: Required<EvictionSettings>;
	preemptiveCompaction: Required<
		Omit<PreemptiveCompactionConfig, "contextLimit" | "absoluteTokenThreshold">
	> & {
		contextLimit?: number;
		absoluteTokenThreshold?: number;
	};
	degradationMonitor: Required<DegradationMonitorConfig>;
	/** Optional; absent by default (adapters are opt-in). */
	adapters?: AdaptersConfig;
} = {
	enabled: true,
	debug: false,
	promptMode: "replace",
	dedup: {
		enabled: true,
		protectedTools: [],
	},
	purgeErrors: {
		enabled: true,
		turns: 4,
		wholeAttempt: true,
		cascade: true,
	},
	compress: {
		protectedTurns: 3,
		reversible: false,
		searchMaxResults: 5,
	},
	eviction: {
		enabled: true,
		thresholdTokens: 200000,
		levels: ["reasoning", "bulk_output", "intermediate", "episode"],
		protectPrologue: true,
	},
	preemptiveCompaction: {
		enabled: false,
		threshold: 0.8,
		countCacheTokens: true,
		minTokensSinceLast: 0,
		cooldownMs: 60000,
	},
	degradationMonitor: {
		enabled: false,
		threshold: 4,
		windowMs: 120000,
	},
};

// ---------------------------------------------------------------------------
// Merge over defaults
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge(
	base: LiveCompactionConfig,
	override: LiveCompactionConfig,
): LiveCompactionConfig {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		// `undefined` means "unset": keep the lower layer's value rather than
		// clobbering a default with undefined.
		if (value === undefined) continue;
		const current = out[key];
		out[key] =
			isPlainObject(value) && isPlainObject(current)
				? deepMerge(
						current as LiveCompactionConfig,
						value as LiveCompactionConfig,
					)
				: value;
	}
	return out as LiveCompactionConfig;
}

const EVICTION_LEVELS: EvictionLevel[] = [
	"reasoning",
	"bulk_output",
	"intermediate",
	"episode",
];

/** A finite number >= 0, else the default. Non-numbers are rejected. */
function nonNegative(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

/**
 * Defensively normalize values that JSON config could set to destructive or
 * nonsensical values (the loader casts `JSON.parse` output without validation).
 */
function normalizeConfig(cfg: ResolvedConfig): ResolvedConfig {
	// A malformed section (e.g. `"dedup": null`) would throw here; coerce it to
	// the default section instead, matching the previous tolerant behavior.
	for (const key of [
		"dedup",
		"eviction",
		"purgeErrors",
		"preemptiveCompaction",
		"degradationMonitor",
	] as const) {
		if (!isPlainObject(cfg[key])) {
			(cfg as Record<string, unknown>)[key] = structuredClone(
				DEFAULT_CONFIG[key],
			);
		}
	}

	cfg.dedup.protectedTools = Array.isArray(cfg.dedup.protectedTools)
		? cfg.dedup.protectedTools.filter((t) => typeof t === "string")
		: [];

	// Preserve an explicit empty array (a way to disable eviction via levels).
	if (!Array.isArray(cfg.eviction.levels)) {
		cfg.eviction.levels = [...EVICTION_LEVELS];
	} else if (cfg.eviction.levels.length > 0) {
		const levels = cfg.eviction.levels.filter((l): l is EvictionLevel =>
			(EVICTION_LEVELS as string[]).includes(l as string),
		);
		cfg.eviction.levels = levels.length > 0 ? levels : [...EVICTION_LEVELS];
	}

	cfg.eviction.thresholdTokens = nonNegative(
		cfg.eviction.thresholdTokens,
		DEFAULT_CONFIG.eviction.thresholdTokens,
	);
	cfg.purgeErrors.turns = Math.floor(
		nonNegative(cfg.purgeErrors.turns, DEFAULT_CONFIG.purgeErrors.turns),
	);
	cfg.preemptiveCompaction.cooldownMs = nonNegative(
		cfg.preemptiveCompaction.cooldownMs,
		DEFAULT_CONFIG.preemptiveCompaction.cooldownMs,
	);
	cfg.preemptiveCompaction.minTokensSinceLast = nonNegative(
		cfg.preemptiveCompaction.minTokensSinceLast,
		DEFAULT_CONFIG.preemptiveCompaction.minTokensSinceLast,
	);
	const threshold = cfg.preemptiveCompaction.threshold;
	if (typeof threshold !== "number" || !(threshold > 0 && threshold <= 1)) {
		cfg.preemptiveCompaction.threshold =
			DEFAULT_CONFIG.preemptiveCompaction.threshold;
	}
	const degThreshold = cfg.degradationMonitor.threshold;
	if (typeof degThreshold !== "number" || !(degThreshold > 0)) {
		cfg.degradationMonitor.threshold =
			DEFAULT_CONFIG.degradationMonitor.threshold;
	}
	cfg.degradationMonitor.windowMs = nonNegative(
		cfg.degradationMonitor.windowMs,
		DEFAULT_CONFIG.degradationMonitor.windowMs,
	);

	// Adapter numerics: drop invalid optional values so the provider default
	// applies (a negative timeoutMs would fire immediately).
	if (isPlainObject(cfg.adapters)) {
		cfg.adapters = structuredClone(cfg.adapters);
		const adapters = cfg.adapters as Record<string, unknown>;
		for (const key of ["embeddings", "scorer"]) {
			const adapter = adapters[key];
			if (!isPlainObject(adapter)) continue;
			for (const field of ["timeoutMs", "maxSamples"] as const) {
				const value = adapter[field];
				if (
					value !== undefined &&
					!(typeof value === "number" && Number.isFinite(value) && value > 0)
				) {
					delete adapter[field];
				}
			}
			const minScore = adapter.minScore;
			if (
				minScore !== undefined &&
				!(typeof minScore === "number" && Number.isFinite(minScore) && minScore >= 0)
			) {
				delete adapter.minScore;
			}
		}
	}

	return cfg;
}

/**
 * Merge user config over defaults. Deep-merges nested objects. The defaults are
 * cloned so a caller cannot mutate the shared `DEFAULT_CONFIG` through the
 * result, and the merged result is normalized defensively.
 */
export function mergeConfig(user: LiveCompactionConfig): ResolvedConfig {
	const merged = deepMerge(
		structuredClone(DEFAULT_CONFIG) as LiveCompactionConfig,
		user,
	) as ResolvedConfig;
	return normalizeConfig(merged);
}

/** The fully-resolved configuration (defaults merged with user config). */
export type ResolvedConfig = typeof DEFAULT_CONFIG;
