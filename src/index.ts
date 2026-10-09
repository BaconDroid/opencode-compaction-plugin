/**
 * opencode-compaction-plugin — Enhanced context compaction plugin for OpenCode.
 *
 * Features:
 * - Structured summary: 11 sections in `replace` mode, or the missing sections
 *   appended to the default prompt in `augment` (default)
 * - Previous compaction summary carried forward (<previous-summary>)
 * - Files-touched manifest with operation badges
 * - Deduplication of repeated tool calls
 * - Error purge (whole-attempt + cascade)
 * - Auto-continue control (skips the compaction agent and duplicates)
 * - Hook error isolation
 * - Model-driven compress tool
 * - Global + project + plugin-option config
 *
 * Usage:
 *   1. Local: copy to `.opencode/plugins/compaction.ts`
 *   2. npm: add "opencode-compaction-plugin" to `plugin` array in opencode.json
 *
 * This file is the wiring only; the logic lives in focused modules:
 *   transform.ts · prompt.ts · compress.ts · strategies.ts · eviction.ts ·
 *   config.ts · …
 */

import {
	buildAugmentPrompt,
	buildCompactionPrompt,
	extractLatestUserAsk,
} from "./core/prompt.js";
import { FilesTouchedTracker } from "./core/files-touched.js";
import { loadConfig } from "./config/config-loader.js";
import type { CompactionConfig } from "./config/config.js";
import { CompressionStore } from "./core/compress.js";
import { resolveScorer } from "./opencode/adapters.js";
import { createModelRunner } from "./opencode/model.js";
import { buildCompressToolDef } from "./opencode/tools.js";
import {
	extractPreviousSummary,
	type SlidingState,
} from "./core/previous-summary.js";
import { applyTransform } from "./core/transform.js";
import type { Hooks, Logger, Plugin, PluginInput } from "./types.js";

/** Model-driven tools registered by this plugin (used for permission wiring). */
const PLUGIN_TOOL_NAMES = [
	"compress",
] as const;

/**
 * Build the plugin logger. `info` is gated by the `debug` flag; `warn` is
 * always emitted — a misconfigured adapter or a swallowed hook error is exactly
 * what you want to see when something silently does nothing.
 */
function makeLogger(
	client: PluginInput["client"],
	debug: boolean,
): Logger {
	const log = (
		level: "info" | "warn",
		message: string,
		data?: unknown,
	): void => {
		// Fire-and-forget; swallow a rejecting log write so it cannot surface as
		// an unhandled rejection.
		void client.app.log({
			body: {
				service: "compaction",
				level,
				message,
				extra: data as Record<string, unknown> | undefined,
			},
		}).catch(() => {});
	};
	return {
		info: (message, data) => {
			if (debug) log("info", message, data);
		},
		warn: (message, data) => {
			log("warn", message, data);
		},
	};
}

/**
 * Auto-continue hardening: suppress duplicate auto-continue for the same
 * session within a short window (timestamp-based; no timers to clean up).
 */
class AutocontinueGuard {
	private marks = new Map<string, number>();

	has(sessionID: string): boolean {
		const at = this.marks.get(sessionID);
		if (at === undefined) return false;
		if (Date.now() - at >= 10_000) {
			this.marks.delete(sessionID);
			return false;
		}
		return true;
	}

	mark(sessionID: string): void {
		this.marks.set(sessionID, Date.now());
	}

	clear(sessionID: string): void {
		this.marks.delete(sessionID);
	}

	clearAll(): void {
		this.marks.clear();
	}
}

/** The SDK wraps list responses in `{ data }`; accept both shapes. */
function unwrapList(response: unknown): unknown[] {
	if (Array.isArray(response)) return response;
	return ((response as { data?: unknown })?.data as unknown[] | undefined) ?? [];
}

export const CompactionPlugin: Plugin = async (ctx, options) => {
	// Load config (defaults < global file < plugin options < project file).
	const configWarnings: string[] = [];
	const config = loadConfig(
		ctx.directory,
		(message) => configWarnings.push(message),
		options as CompactionConfig | undefined,
	);
	const logger = makeLogger(ctx.client, config.debug ?? false);

	// Surface config problems regardless of the debug flag.
	for (const warning of configWarnings) {
		void ctx.client.app.log({
			body: { service: "compaction", level: "warn", message: warning },
		}).catch(() => {});
	}

	// Kill switch: `enabled: false` disables every hook.
	if (!config.enabled) {
		logger.info("plugin disabled via config");
		return {};
	}

	logger.info("initialized", {
		dedup: config.dedup?.enabled,
		purgeErrors: config.purgeErrors?.enabled,
	});

	// Per-instance state.
	const sessionTrackers = new Map<string, FilesTouchedTracker>();
	const compressions = new CompressionStore();
	const slidingState = new Map<string, SlidingState>();
	const autocontinue = new AutocontinueGuard();

	// Optional scorer adapter (opt-in) for the eviction budget. The model
	// runner backs its opencode provider.
	const adapterDeps = {
		logger,
		modelRunner: createModelRunner(ctx.client, ctx.directory),
	};
	const scorer = resolveScorer(config.adapters?.scorer, adapterDeps);

	const getTracker = (sessionID: string): FilesTouchedTracker => {
		let tracker = sessionTrackers.get(sessionID);
		if (!tracker) {
			tracker = new FilesTouchedTracker();
			sessionTrackers.set(sessionID, tracker);
		}
		return tracker;
	};

	// Isolate hook failures: a thrown error is logged and swallowed so it cannot
	// break compaction or the message pipeline.
	const safe = <T extends (...args: any[]) => any>(name: string, fn: T): T =>
		(async (...args: Parameters<T>) => {
			try {
				return await fn(...args);
			} catch (error) {
				logger.warn(`hook error: ${name}`, { error: String(error) });
				return undefined;
			}
		}) as T;

	const hooks: Hooks = {
		"tool.execute.after": async (input) => {
			const { tool, sessionID, args } = input;
			if (!sessionID || !args) return;

			getTracker(sessionID).processToolCall(
				tool,
				args as Record<string, unknown>,
			);

			const a = args as Record<string, unknown>;

			if (tool === "compress" && typeof a.topic === "string" && typeof a.summary === "string") {
				const start = typeof a.start === "number" ? a.start : undefined;
				const end = typeof a.end === "number" ? a.end : undefined;
				const scale =
					a.scale === "granular" || a.scale === "deep" ? a.scale : undefined;
				compressions.queue(sessionID, {
					topic: a.topic,
					start,
					end,
					scale,
					summary: a.summary,
					timestamp: Date.now(),
					callID: input.callID,
				});
				logger.info("compress queued", {
					sessionID,
					topic: a.topic,
					range:
						start !== undefined && end !== undefined
							? `${start}-${end}`
							: "auto",
				});
			}
		},

		"experimental.session.compacting": async (input, output) => {
			const { sessionID } = input;
			const augment = config.promptMode === "augment";

			let previousSummary: string | undefined;
			let latestAsk: string | undefined;
			const fetchMessages = ctx.client.session?.messages;
			if (fetchMessages) {
				try {
					const response = await fetchMessages({ path: { id: sessionID } });
					const list = unwrapList(response);
					latestAsk = extractLatestUserAsk(list);
					// In replace mode the default prompt (which carries the previous
					// summary) is discarded, so fetch and re-inject it ourselves. In
					// augment mode the default prompt already carries it.
					if (!augment) {
						const state = slidingState.get(sessionID) ?? {};
						previousSummary = extractPreviousSummary(list, state);
						slidingState.set(sessionID, state);
					}
				} catch (error) {
					logger.info("message fetch failed", { error: String(error) });
				}
			}

			const tracker = getTracker(sessionID);
			const filesManifest =
				tracker.size > 0 ? tracker.renderManifest() : undefined;
			// Clear tracker after compaction since old operations are now in the summary.
			tracker.clear();

			if (augment) {
				// Keep OpenCode's default prompt and append only the delta (the
				// sections the default summary lacks).
				output.context.push(
					buildAugmentPrompt({ filesTouched: filesManifest, focus: latestAsk }),
				);
			} else {
				// Replace the default compaction prompt with the full 11-section template.
				output.prompt = buildCompactionPrompt({
					filesTouched: filesManifest,
					previousSummary,
					focus: latestAsk,
				});
			}

			logger.info("compaction triggered", {
				sessionID,
				hasFiles: !!filesManifest,
				mode: config.promptMode,
			});
		},

		// Runs before OpenCode's own 2000-char truncation.
		"experimental.chat.messages.transform": async (_input, output) => {
			await applyTransform(output.messages, {
				config,
				logger,
				compressions,
				scorer,
				scorerMaxSamples: config.adapters?.scorer?.maxSamples,
			});
		},

		"experimental.compaction.autocontinue": async (input, output) => {
			if (
				typeof input.agent === "string" &&
				input.agent.trim().toLowerCase() === "compaction"
			) {
				output.enabled = false;
				return;
			}

			const sessionID =
				typeof input.sessionID === "string" ? input.sessionID : undefined;
			if (sessionID) {
				if (autocontinue.has(sessionID)) {
					output.enabled = false;
					logger.info("autocontinue suppressed (duplicate)");
					return;
				}
				autocontinue.mark(sessionID);
			}

			output.enabled = true;
		},

		event: async ({ event }) => {
			// The SDK carries the session under `info.id` for some events,
			// `info.sessionID` for messages, and `sessionID` for others.
			const props = event.properties as
				| {
						sessionID?: string;
						info?: { id?: string; sessionID?: string };
					}
				| undefined;
			const sessionID =
				props?.sessionID ?? props?.info?.id ?? props?.info?.sessionID;

			if (event.type === "session.deleted" && sessionID) {
				sessionTrackers.delete(sessionID);
				compressions.clear(sessionID);
				slidingState.delete(sessionID);
				autocontinue.clear(sessionID);
			}
		},

		dispose: async () => {
			sessionTrackers.clear();
			compressions.clearAll();
			slidingState.clear();
			autocontinue.clearAll();
		},

		config: async (opencodeConfig) => {
			// Without clobbering a global permission string (e.g. "allow") or any
			// explicit per-tool rule (deny, ask, or a pattern object): only fill in
			// an unset entry.
			const permission = opencodeConfig.permission;
			if (typeof permission !== "string") {
				const map = (permission as Record<string, unknown> | undefined) ?? {};
				const next: Record<string, unknown> = { ...map };
				let changed = false;
				for (const toolName of PLUGIN_TOOL_NAMES) {
					if (next[toolName] === undefined) {
						next[toolName] = "allow";
						changed = true;
					}
				}
				if (changed) opencodeConfig.permission = next;
			}
			// The built-in `/compact` command is intentionally left untouched.
		},

		// The `tool` hook maps a tool name to its definition.
		tool: {
			compress: buildCompressToolDef(),
		},
	};

	// Wrap every hook so a thrown error is isolated (see `safe`).
	for (const key of Object.keys(hooks) as (keyof Hooks)[]) {
		const value = hooks[key];
		if (typeof value === "function") {
			(hooks as Record<string, unknown>)[key] = safe(
				key as string,
				value as (...args: unknown[]) => unknown,
			);
		}
	}

	return hooks;
};

export default CompactionPlugin;
