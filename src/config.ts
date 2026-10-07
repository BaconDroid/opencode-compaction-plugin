/**
 * Configuration for opencode-live-compaction.
 *
 * Loads from .opencode/live-compaction.json (project) or falls back to defaults.
 * All fields are optional — missing keys use sensible defaults.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { EvictionLevel } from "./eviction.js";

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
	/** Keep compressed originals in memory for expand (default: true) */
	reversible?: boolean;
	/** Maximum number of blocks merged by a single squash (default: 8) */
	maxBlocksPerSquash?: number;
}

export interface EvictionSettings {
	/** Enable graduated LLM-free eviction (default: false) */
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
	/** Count cache read/write tokens in the usage (default: false) */
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

export interface DegradationMonitorConfig {
	/** Enable the post-compaction degradation diagnostic (default: false) */
	enabled?: boolean;
	/** Consecutive assistant messages without text that trigger a warning (default: 4) */
	threshold?: number;
	/** Window after compaction during which the check runs, in ms (default: 120000) */
	windowMs?: number;
	/** Judge-free halt: distance below which drafts are converged (default: 0.05) */
	convergenceThreshold?: number;
	/** Judge-free halt: consecutive converged steps required (default: 3) */
	convergencePatience?: number;
	/** Judge-free halt: failsafe round cap (default: 12) */
	maxRounds?: number;
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
	/** Turn-based protection: protect recent tool outputs from trimming */
	turnProtection?: TurnProtectionConfig;
	/** Proactive compaction before the context overflows */
	preemptiveCompaction?: PreemptiveCompactionConfig;
	/** How the compaction prompt is applied: replace the default or augment it (default: "replace") */
	promptMode?: "replace" | "augment";
	/** Post-compaction degradation diagnostic */
	degradationMonitor?: DegradationMonitorConfig;
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
		| "turnProtection"
		| "preemptiveCompaction"
		| "degradationMonitor"
	>
> & {
	trim: Required<TrimLimits>;
	dedup: Required<DedupConfig>;
	purgeErrors: Required<PurgeErrorsConfig>;
	compress: Required<CompressConfig>;
	eviction: Required<EvictionSettings>;
	turnProtection: Required<TurnProtectionConfig>;
	preemptiveCompaction: Required<
		Omit<PreemptiveCompactionConfig, "contextLimit" | "absoluteTokenThreshold">
	> & {
		contextLimit?: number;
		absoluteTokenThreshold?: number;
	};
	degradationMonitor: Required<DegradationMonitorConfig>;
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
		reversible: true,
		maxBlocksPerSquash: 8,
	},
	eviction: {
		enabled: false,
		thresholdTokens: 80000,
		levels: ["reasoning", "bulk_output", "intermediate", "episode"],
		protectPrologue: true,
	},
	turnProtection: {
		enabled: true,
		turns: 4,
	},
	preemptiveCompaction: {
		enabled: false,
		threshold: 0.78,
		countCacheTokens: false,
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
		convergenceThreshold: 0.05,
		convergencePatience: 3,
		maxRounds: 12,
	},
	protectedFilePatterns: [],
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES = ["live-compaction.json", "live-compaction.jsonc"];

/**
 * Directory of the global OpenCode config. Uses `XDG_CONFIG_HOME` when set
 * (which also covers the Flatpak layout) and falls back to `~/.config`.
 */
export function globalConfigDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg && xdg.trim() ? xdg : join(homedir(), ".config");
	return join(base, "opencode");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
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

function readConfigDir(
	dir: string,
	onError?: (message: string, error?: unknown) => void,
): LiveCompactionConfig | undefined {
	for (const name of CONFIG_FILE_NAMES) {
		const configPath = join(dir, name);
		if (!existsSync(configPath)) continue;
		try {
			const raw = readFileSync(configPath, "utf-8");
			const stripped = stripTrailingCommas(stripJsonComments(raw));
			return JSON.parse(stripped) as LiveCompactionConfig;
		} catch (error) {
			onError?.(`failed to parse ${configPath}`, error);
		}
	}
	return undefined;
}

/**
 * Load config with precedence, low to high:
 *   defaults < global config file < plugin options < project-local config file.
 *
 * The global file lives in the OpenCode config directory (see
 * {@link globalConfigDir}); the project file lives in `<project>/.opencode/`.
 */
export function loadConfig(
	projectDir: string,
	onError?: (message: string, error?: unknown) => void,
	overrides?: LiveCompactionConfig,
): ReturnType<typeof mergeConfig> {
	let user: LiveCompactionConfig = {};

	const globalConfig = readConfigDir(globalConfigDir(), onError);
	if (globalConfig) user = deepMerge(user, globalConfig);

	if (overrides) user = deepMerge(user, overrides);

	const projectConfig = readConfigDir(join(projectDir, ".opencode"), onError);
	if (projectConfig) user = deepMerge(user, projectConfig);

	return mergeConfig(user);
}

/**
 * Merge user config over defaults. Deep-merges nested objects.
 */
export function mergeConfig(user: LiveCompactionConfig) {
	return {
		enabled: user.enabled ?? DEFAULT_CONFIG.enabled,
		debug: user.debug ?? DEFAULT_CONFIG.debug,
		trim: { ...DEFAULT_CONFIG.trim, ...user.trim },
		dedup: {
			enabled: user.dedup?.enabled ?? DEFAULT_CONFIG.dedup.enabled,
			protectedTools:
				user.dedup?.protectedTools ?? DEFAULT_CONFIG.dedup.protectedTools,
		},
		purgeErrors: {
			enabled: user.purgeErrors?.enabled ?? DEFAULT_CONFIG.purgeErrors.enabled,
			turns: user.purgeErrors?.turns ?? DEFAULT_CONFIG.purgeErrors.turns,
			wholeAttempt:
				user.purgeErrors?.wholeAttempt ??
				DEFAULT_CONFIG.purgeErrors.wholeAttempt,
			cascade:
				user.purgeErrors?.cascade ?? DEFAULT_CONFIG.purgeErrors.cascade,
		},
		compress: {
			protectedTurns:
				user.compress?.protectedTurns ?? DEFAULT_CONFIG.compress.protectedTurns,
			reversible:
				user.compress?.reversible ?? DEFAULT_CONFIG.compress.reversible,
			maxBlocksPerSquash:
				user.compress?.maxBlocksPerSquash ??
				DEFAULT_CONFIG.compress.maxBlocksPerSquash,
		},
		eviction: {
			enabled: user.eviction?.enabled ?? DEFAULT_CONFIG.eviction.enabled,
			thresholdTokens:
				user.eviction?.thresholdTokens ??
				DEFAULT_CONFIG.eviction.thresholdTokens,
			levels: user.eviction?.levels ?? DEFAULT_CONFIG.eviction.levels,
			protectPrologue:
				user.eviction?.protectPrologue ??
				DEFAULT_CONFIG.eviction.protectPrologue,
		},
		turnProtection: {
			enabled:
				user.turnProtection?.enabled ?? DEFAULT_CONFIG.turnProtection.enabled,
			turns: user.turnProtection?.turns ?? DEFAULT_CONFIG.turnProtection.turns,
		},
		preemptiveCompaction: {
			enabled:
				user.preemptiveCompaction?.enabled ??
				DEFAULT_CONFIG.preemptiveCompaction.enabled,
			threshold:
				user.preemptiveCompaction?.threshold ??
				DEFAULT_CONFIG.preemptiveCompaction.threshold,
			countCacheTokens:
				user.preemptiveCompaction?.countCacheTokens ??
				DEFAULT_CONFIG.preemptiveCompaction.countCacheTokens,
			minTokensSinceLast:
				user.preemptiveCompaction?.minTokensSinceLast ??
				DEFAULT_CONFIG.preemptiveCompaction.minTokensSinceLast,
			minMessagesSinceLast:
				user.preemptiveCompaction?.minMessagesSinceLast ??
				DEFAULT_CONFIG.preemptiveCompaction.minMessagesSinceLast,
			tailGuard: {
				enabled:
					user.preemptiveCompaction?.tailGuard?.enabled ??
					DEFAULT_CONFIG.preemptiveCompaction.tailGuard.enabled,
				minNewToolCalls:
					user.preemptiveCompaction?.tailGuard?.minNewToolCalls ??
					DEFAULT_CONFIG.preemptiveCompaction.tailGuard.minNewToolCalls,
			},
			cooldownMs:
				user.preemptiveCompaction?.cooldownMs ??
				DEFAULT_CONFIG.preemptiveCompaction.cooldownMs,
			contextLimit: user.preemptiveCompaction?.contextLimit,
			absoluteTokenThreshold:
				user.preemptiveCompaction?.absoluteTokenThreshold,
		},
		promptMode: user.promptMode ?? DEFAULT_CONFIG.promptMode,
		degradationMonitor: {
			enabled:
				user.degradationMonitor?.enabled ??
				DEFAULT_CONFIG.degradationMonitor.enabled,
			threshold:
				user.degradationMonitor?.threshold ??
				DEFAULT_CONFIG.degradationMonitor.threshold,
			windowMs:
				user.degradationMonitor?.windowMs ??
				DEFAULT_CONFIG.degradationMonitor.windowMs,
			convergenceThreshold:
				user.degradationMonitor?.convergenceThreshold ??
				DEFAULT_CONFIG.degradationMonitor.convergenceThreshold,
			convergencePatience:
				user.degradationMonitor?.convergencePatience ??
				DEFAULT_CONFIG.degradationMonitor.convergencePatience,
			maxRounds:
				user.degradationMonitor?.maxRounds ??
				DEFAULT_CONFIG.degradationMonitor.maxRounds,
		},
		protectedFilePatterns:
			user.protectedFilePatterns ?? DEFAULT_CONFIG.protectedFilePatterns,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip single-line and block comments from JSONC strings. */
function stripJsonComments(json: string): string {
	// Remove single-line comments (// ...) not inside strings
	let result = "";
	let inString = false;
	let escape = false;

	for (let i = 0; i < json.length; i++) {
		const ch = json[i];

		if (escape) {
			result += ch;
			escape = false;
			continue;
		}

		if (ch === "\\" && inString) {
			result += ch;
			escape = true;
			continue;
		}

		if (ch === '"') {
			inString = !inString;
			result += ch;
			continue;
		}

		if (inString) {
			result += ch;
			continue;
		}

		// Not in string — check for comments
		if (ch === "/" && i + 1 < json.length) {
			if (json[i + 1] === "/") {
				// Single-line comment: skip to end of line
				while (i < json.length && json[i] !== "\n") i++;
				result += "\n";
				continue;
			}
			if (json[i + 1] === "*") {
				// Block comment: skip to */
				i += 2;
				while (
					i + 1 < json.length &&
					!(json[i] === "*" && json[i + 1] === "/")
				) {
					i++;
				}
				i++; // skip the /
				continue;
			}
		}

		result += ch;
	}

	return result;
}

/** Remove trailing commas before `}` or `]`, ignoring commas inside strings. */
function stripTrailingCommas(json: string): string {
	let result = "";
	let inString = false;
	let escape = false;

	for (let i = 0; i < json.length; i++) {
		const ch = json[i];

		if (escape) {
			result += ch;
			escape = false;
			continue;
		}

		if (ch === "\\" && inString) {
			result += ch;
			escape = true;
			continue;
		}

		if (ch === '"') {
			inString = !inString;
			result += ch;
			continue;
		}

		if (inString) {
			result += ch;
			continue;
		}

		if (ch === ",") {
			let j = i + 1;
			while (j < json.length && /\s/.test(json[j])) j++;
			if (json[j] === "}" || json[j] === "]") {
				continue; // drop the trailing comma
			}
		}

		result += ch;
	}

	return result;
}
