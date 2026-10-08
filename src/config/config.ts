/**
 * Configuration model for opencode-live-compaction: types, defaults and the
 * merge over defaults. File loading lives in `config-loader.ts`.
 */

import type { EvictionLevel } from "../core/eviction.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrimLimits {
	/** Max chars for bash/shell outputs (default: 600) */
	bash?: number;
	/** Max chars for write confirmations (default: 100) */
	write?: number;
	/** Max chars for edit confirmations (default: 100) */
	edit?: number;
	/** Max chars for delete confirmations (default: 50) */
	delete?: number;
	/** Max chars for file reads (default: 300) */
	read?: number;
	/** Max chars for file listings (default: 200) */
	glob?: number;
	/** Max chars for search results (default: 400) */
	grep?: number;
	/** Max chars for directory listings (default: 200) */
	list?: number;
	/** Default max chars for unlisted tools (default: 500) */
	default?: number;
}

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
	/** Maximum number of blocks merged by a single squash (default: 8) */
	maxBlocksPerSquash?: number;
	/** Maximum hits returned by the `search` tool (default: 5) */
	searchMaxResults?: number;
}

export interface PinningConfig {
	/** Enable constraint pinning (default: true; inert until patterns are set) */
	enabled?: boolean;
	/** Case-insensitive substrings that mark a message/line as a pinned constraint */
	patterns?: string[];
	/** Maximum pinned clauses re-injected into the prompt (default: 20) */
	maxClauses?: number;
}

export interface EvictionSettings {
	/** Enable graduated LLM-free eviction (default: true) */
	enabled?: boolean;
	/** Token budget; eviction runs only above it (default: 80000) */
	thresholdTokens?: number;
	/** Levels to apply, in order (default: reasoning, bulk_output, intermediate, episode) */
	levels?: EvictionLevel[];
	/** Protect the prologue from eviction (default: true) */
	protectPrologue?: boolean;
}

export interface TurnProtectionConfig {
	/** Enable turn-based protection (default: true) */
	enabled?: boolean;
	/** Number of recent turns whose tool outputs are protected from trimming (default: 4) */
	turns?: number;
}

export interface TailGuardConfig {
	/** Enable the tail guard (default: false) */
	enabled?: boolean;
	/** Minimum new tool calls since the last compaction before compacting (default: 3) */
	minNewToolCalls?: number;
}

export interface PreemptiveCompactionConfig {
	/** Compact proactively before the context overflows (default: false) */
	enabled?: boolean;
	/** Fraction of the context limit that triggers compaction (default: 0.78) */
	threshold?: number;
	/** Absolute token ceiling for the trigger; the smaller of ratio and this wins */
	absoluteTokenThreshold?: number;
	/** Count cache read/write tokens in the usage (default: true) */
	countCacheTokens?: boolean;
	/** Minimum new tokens since the last compaction before compacting (default: 0) */
	minTokensSinceLast?: number;
	/** Minimum new messages since the last compaction before compacting (default: 0) */
	minMessagesSinceLast?: number;
	/** Do not compact until enough new tool calls accumulated since the last compaction */
	tailGuard?: TailGuardConfig;
	/** Minimum delay between proactive compactions, in ms (default: 60000) */
	cooldownMs?: number;
	/** Override the model context limit (otherwise resolved from the provider) */
	contextLimit?: number;
}

/** Transport for an optional external adapter. */
export type AdapterProvider = "http" | "command" | "mcp";

/**
 * Optional semantic embedding/retrieval adapter (E2/E3/E4). Opt-in: the feature
 * is disabled unless this block is present. Providers talk to an existing
 * endpoint/command; no SDK or model is bundled.
 */
export interface EmbeddingsAdapterConfig {
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
	/** Minimum cosine score for a semantic hit (default: 0) */
	minScore?: number;
}

/**
 * Optional model-judge adapter (E1/E5/E6). Opt-in: disabled unless present.
 * The judge answers a prompt; callers build the prompt and read the verdict.
 */
export interface JudgeAdapterConfig {
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
 * Optional residual/perplexity scorer adapter (E5/E9). Opt-in: disabled unless
 * present. Refines the eviction budget estimate; absent → heuristic.
 */
export interface ScorerAdapterConfig {
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
	/** Maximum distinct texts scored per transform (default: 200) */
	maxSamples?: number;
}

/** Optional external adapters (all off by default). */
export interface AdaptersConfig {
	/** Semantic embedding/retrieval adapter */
	embeddings?: EmbeddingsAdapterConfig;
	/** Model-judge adapter (semantic validation) */
	judge?: JudgeAdapterConfig;
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
	/** Tool output trim limits by tool name */
	trim?: TrimLimits;
	/** Deduplication strategy */
	dedup?: DedupConfig;
	/** Error input purging strategy */
	purgeErrors?: PurgeErrorsConfig;
	/** Model-driven compress tool settings */
	compress?: CompressConfig;
	/** Graduated, LLM-free eviction */
	eviction?: EvictionSettings;
	/** Constraint pinning (E6): keep matched constraints through compaction */
	pinning?: PinningConfig;
	/** Turn-based protection: protect recent tool outputs from trimming */
	turnProtection?: TurnProtectionConfig;
	/** Proactive compaction before the context overflows */
	preemptiveCompaction?: PreemptiveCompactionConfig;
	/** How the compaction prompt is applied: replace the default or augment it (default: "replace") */
	promptMode?: "replace" | "augment";
	/** Post-compaction degradation diagnostic */
	degradationMonitor?: DegradationMonitorConfig;
	/** Optional external adapters (semantic retrieval, judge, scorer) */
	adapters?: AdaptersConfig;
	/** Glob patterns for files whose tool outputs should never be trimmed (default: []) */
	protectedFilePatterns?: string[];
	/** Enable debug logging (default: false) */
	debug?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TRIM: Required<TrimLimits> = {
	bash: 600,
	write: 100,
	edit: 100,
	delete: 50,
	read: 300,
	glob: 200,
	grep: 400,
	list: 200,
	default: 500,
};

export const DEFAULT_CONFIG: Required<
	Omit<
		LiveCompactionConfig,
		| "trim"
		| "dedup"
		| "purgeErrors"
		| "compress"
		| "eviction"
		| "pinning"
		| "turnProtection"
		| "preemptiveCompaction"
		| "degradationMonitor"
		| "adapters"
	>
> & {
	trim: Required<TrimLimits>;
	dedup: Required<DedupConfig>;
	purgeErrors: Required<PurgeErrorsConfig>;
	compress: Required<CompressConfig>;
	eviction: Required<EvictionSettings>;
	pinning: Required<PinningConfig>;
	turnProtection: Required<TurnProtectionConfig>;
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
	trim: { ...DEFAULT_TRIM },
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
		maxBlocksPerSquash: 8,
		searchMaxResults: 5,
	},
	eviction: {
		enabled: true,
		thresholdTokens: 80000,
		levels: ["reasoning", "bulk_output", "intermediate", "episode"],
		protectPrologue: true,
	},
	pinning: {
		enabled: true,
		patterns: [],
		maxClauses: 20,
	},
	turnProtection: {
		enabled: true,
		turns: 4,
	},
	preemptiveCompaction: {
		enabled: false,
		threshold: 0.78,
		countCacheTokens: true,
		minTokensSinceLast: 0,
		minMessagesSinceLast: 0,
		tailGuard: {
			enabled: false,
			minNewToolCalls: 3,
		},
		cooldownMs: 60000,
	},
	degradationMonitor: {
		enabled: false,
		threshold: 4,
		windowMs: 120000,
	},
	protectedFilePatterns: [],
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

/**
 * Merge user config over defaults. Deep-merges nested objects.
 */
export function mergeConfig(user: LiveCompactionConfig): ResolvedConfig {
	return deepMerge(
		DEFAULT_CONFIG as LiveCompactionConfig,
		user,
	) as ResolvedConfig;
}

/** The fully-resolved configuration (defaults merged with user config). */
export type ResolvedConfig = typeof DEFAULT_CONFIG;
