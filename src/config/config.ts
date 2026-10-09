/**
 * Configuration model for opencode-compaction-plugin: types, defaults and the
 * merge over defaults. File loading lives in `config-loader.ts`.
 */

import type { EvictionLevel } from "../core/eviction.js";

// Types

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

/** Transport for an optional external adapter. */
export type AdapterProvider = "http" | "command" | "mcp" | "opencode";

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
 * Optional residual/perplexity scorer adapter (E5/E9). Refines the eviction
 * budget estimate; absent → heuristic.
 */
export interface ScorerAdapterConfig extends AdapterTransportConfig {
	/** Maximum distinct texts scored per transform (default: 200) */
	maxSamples?: number;
}

/** Optional external adapters (all off by default). */
export interface AdaptersConfig {
	/** Residual/perplexity scorer adapter (eviction budget) */
	scorer?: ScorerAdapterConfig;
}

export interface CompactionConfig {
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
	/** How the compaction prompt is applied: replace the default or augment it (default: "replace") */
	promptMode?: "replace" | "augment";
	/** Optional external adapters (scorer) */
	adapters?: AdaptersConfig;
	/** Enable debug logging (default: false) */
	debug?: boolean;
}

// Defaults

export const DEFAULT_CONFIG: Required<
	Omit<
		CompactionConfig,
		"dedup" | "purgeErrors" | "compress" | "eviction" | "adapters"
	>
> & {
	dedup: Required<DedupConfig>;
	purgeErrors: Required<PurgeErrorsConfig>;
	compress: Required<CompressConfig>;
	eviction: Required<EvictionSettings>;
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
	},
	eviction: {
		enabled: true,
		thresholdTokens: 200000,
		levels: ["reasoning", "bulk_output", "intermediate", "episode"],
		protectPrologue: true,
	},
};

// Merge over defaults

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge(
	base: CompactionConfig,
	override: CompactionConfig,
): CompactionConfig {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		// `undefined` means "unset": keep the lower layer's value rather than
		// clobbering a default with undefined.
		if (value === undefined) continue;
		const current = out[key];
		out[key] =
			isPlainObject(value) && isPlainObject(current)
				? deepMerge(
						current as CompactionConfig,
						value as CompactionConfig,
					)
				: value;
	}
	return out as CompactionConfig;
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

/** A real boolean, else the default. Non-booleans are rejected. */
function booleanOr(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
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
		"compress",
		"eviction",
		"purgeErrors",
	] as const) {
		if (!isPlainObject(cfg[key])) {
			(cfg as Record<string, unknown>)[key] = structuredClone(
				DEFAULT_CONFIG[key],
			);
		}
	}

	// Booleans: a non-boolean JSON value is rejected in favour of the default.
	cfg.enabled = booleanOr(cfg.enabled, DEFAULT_CONFIG.enabled);
	cfg.debug = booleanOr(cfg.debug, DEFAULT_CONFIG.debug);
	cfg.dedup.enabled = booleanOr(cfg.dedup.enabled, DEFAULT_CONFIG.dedup.enabled);
	cfg.purgeErrors.enabled = booleanOr(
		cfg.purgeErrors.enabled,
		DEFAULT_CONFIG.purgeErrors.enabled,
	);
	cfg.purgeErrors.wholeAttempt = booleanOr(
		cfg.purgeErrors.wholeAttempt,
		DEFAULT_CONFIG.purgeErrors.wholeAttempt,
	);
	cfg.purgeErrors.cascade = booleanOr(
		cfg.purgeErrors.cascade,
		DEFAULT_CONFIG.purgeErrors.cascade,
	);
	cfg.eviction.enabled = booleanOr(
		cfg.eviction.enabled,
		DEFAULT_CONFIG.eviction.enabled,
	);
	cfg.eviction.protectPrologue = booleanOr(
		cfg.eviction.protectPrologue,
		DEFAULT_CONFIG.eviction.protectPrologue,
	);

	// Integers / enumeration.
	cfg.compress.protectedTurns = Math.floor(
		nonNegative(
			cfg.compress.protectedTurns,
			DEFAULT_CONFIG.compress.protectedTurns,
		),
	);
	if (cfg.promptMode !== "replace" && cfg.promptMode !== "augment") {
		cfg.promptMode = DEFAULT_CONFIG.promptMode;
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

	// Adapter numerics: drop invalid optional values so the provider default
	// applies (a negative timeoutMs would fire immediately).
	if (isPlainObject(cfg.adapters)) {
		cfg.adapters = structuredClone(cfg.adapters);
		const adapter = (cfg.adapters as Record<string, unknown>).scorer;
		if (isPlainObject(adapter)) {
			for (const field of ["timeoutMs", "maxSamples"] as const) {
				const value = adapter[field];
				if (
					value !== undefined &&
					!(typeof value === "number" && Number.isFinite(value) && value > 0)
				) {
					delete adapter[field];
				}
			}
			// A non-boolean `enabled` is dropped so the documented default (on
			// when the block is present) applies.
			if (
				adapter.enabled !== undefined &&
				typeof adapter.enabled !== "boolean"
			) {
				delete adapter.enabled;
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
export function mergeConfig(user: CompactionConfig): ResolvedConfig {
	return normalizeConfig(
		deepMerge(
			structuredClone(DEFAULT_CONFIG) as CompactionConfig,
			user,
		) as ResolvedConfig,
	);
}

/** The fully-resolved configuration (defaults merged with user config). */
export type ResolvedConfig = typeof DEFAULT_CONFIG;
