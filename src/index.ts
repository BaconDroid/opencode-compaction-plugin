/**
 * opencode-compaction-plugin - Enhanced context compaction plugin for OpenCode.
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
 *   2. npm: add "opencode-compaction-plugin" to the `plugins` array in opencode.json
 *
 * This file is the wiring only; the logic lives in focused modules:
 *   transform.ts - prompt.ts - compress.ts - strategies.ts - eviction.ts -
 *   config.ts - ...
 *
 * OpenCode 2 contract (2.0.30): the default export is a definition object with
 * a stable `id` and a `setup(ctx)` function. `setup` registers hooks through
 * the context domains and may return a cleanup function. Plugin options arrive
 * on `ctx.options` from the config entry
 * (`plugins: [{ package: "...", options: { ... } }]`).
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
import { projectMessages, projectSessionMessages } from "./opencode/v2.js";
import type { Logger, Plugin, PluginContext, PluginInput } from "./types.js";

/** Plugin id: used by the host for storage scoping and diagnostics. */
const PLUGIN_ID = "opencode-compaction-plugin";

/** Prefix for diagnostics written to the server process console. */
const LOG_PREFIX = `[${PLUGIN_ID}]`;

/** Render structured log data without ever throwing on a cyclic value. */
function describe(data: unknown): string {
	if (data === undefined) return "";
	try {
		return ` ${JSON.stringify(data)}`;
	} catch {
		return ` ${String(data)}`;
	}
}

/**
 * Write one diagnostic line to the server process console (stderr).
 *
 * The 2.0 plugin context has no app-log handle, and the `run` CLI reserves
 * stdout for assistant text, so stderr is the channel that survives
 * `--print-logs` capture.
 */
function writeLine(line: string): void {
	process.stderr.write(`${line}\n`);
}

/**
 * Build the plugin logger. `info` is gated by the `debug` flag; `warn` is
 * always emitted - a misconfigured adapter or a swallowed hook error is exactly
 * what you want to see when something silently does nothing.
 */
function makeLogger(debug: boolean): Logger {
	return {
		info: (message, data) => {
			if (debug) writeLine(`${LOG_PREFIX} ${message}${describe(data)}`);
		},
		warn: (message, data) => {
			writeLine(`${LOG_PREFIX} ${message}${describe(data)}`);
		},
	};
}

/**
 * Auto-continue hardening.
 *
 * The V1 `experimental.compaction.autocontinue` hook gated a synthetic
 * "continue" turn. OpenCode 2 has no such hook: the session runner continues
 * the step loop after auto-compaction itself and already refuses to compact
 * again while the last message is a completed compaction, so the loop the guard
 * protected against cannot form. The behaviour (auto-continue enabled, no
 * duplicate trigger) is preserved by the host.
 */

/**
 * Adapt the 2.0 context to the V1-shaped client surface the optional
 * model-backed scorer and the message helpers already use.
 *
 * - `session.messages` maps to `session.context`, which returns the active
 *   context (the previous checkpoint is included, so continuity still works).
 * - `session.prompt` maps to the stateless `generate.text`: OpenCode 2 has no
 *   session prompt that returns the assistant text synchronously, and a
 *   sandboxed session would re-enter this plugin's transform hook.
 */
function makeRuntimeClient(ctx: PluginContext): PluginInput["client"] {
	let seq = 0;
	return {
		app: {
			log: (input) => {
				const { message, extra } = input.body;
				writeLine(`${LOG_PREFIX} ${message}${describe(extra)}`);
				return Promise.resolve();
			},
		},
		session: {
			messages: async ({ path }) => ({
				data: projectSessionMessages(await ctx.session.context({ sessionID: path.id })),
			}),
			// `generate.text` is stateless, so the id only satisfies the runner's
			// handle contract.
			create: async () => ({ data: { id: `${PLUGIN_ID}:generate:${++seq}` } }),
			prompt: async ({ body }) => {
				const prompt = (body?.parts ?? [])
					.map((part) => (typeof part.text === "string" ? part.text : ""))
					.join("\n");
				const system = typeof body?.system === "string" ? body.system : undefined;
				const model = body?.model
					? { providerID: body.model.providerID, id: body.model.modelID }
					: undefined;
				const response = await ctx.generate.text({
					prompt: system ? `${system}\n\n${prompt}` : prompt,
					...(model ? { model } : {}),
				});
				return { data: { parts: [{ type: "text", text: response.text }] } };
			},
			delete: async () => ({}),
		},
	};
}

export const CompactionPlugin: Plugin = {
	id: PLUGIN_ID,

	async setup(ctx) {
		// Load config (defaults < global file < plugin options < project file).
		const configWarnings: string[] = [];
		const config = loadConfig(
			ctx.location.directory,
			(message) => configWarnings.push(message),
			ctx.options as CompactionConfig | undefined,
		);
		const logger = makeLogger(config.debug ?? false);

		// Surface config problems regardless of the debug flag.
		for (const warning of configWarnings) logger.warn(warning);

		// Kill switch: `enabled: false` disables every hook.
		if (!config.enabled) {
			logger.info("plugin disabled via config");
			return;
		}

		logger.info("initialized", {
			dedup: config.dedup?.enabled,
			purgeErrors: config.purgeErrors?.enabled,
		});

		// Per-instance state.
		const sessionTrackers = new Map<string, FilesTouchedTracker>();
		const compressions = new CompressionStore();
		const slidingState = new Map<string, SlidingState>();

		// Optional scorer adapter (opt-in) for the eviction budget. The model
		// runner backs its opencode provider.
		const adapterDeps = {
			logger,
			modelRunner: createModelRunner(makeRuntimeClient(ctx), ctx.location.directory),
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

		// `tool.execute.after` -> `ctx.tool.hook("execute.after")`. The 2.0 event
		// renames V1's `callID`/`args` to `id`/`input`.
		await ctx.tool.hook(
			"execute.after",
			safe("tool.execute.after", async (event) => {
				const { tool, sessionID } = event;
				// V1 signatures carried the arguments as `args`.
				const args = event.input;
				const callID = event.id;
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
						callID,
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
			}),
		);

		// `experimental.session.compacting` -> `ctx.session.hook("compaction")`.
		//
		// The host appends its own summary prompt after hooks run, so the plugin
		// injects its prompt delta as an extra system part instead of replacing
		// it. In `replace` mode the text also states that it supersedes any other
		// template in the request.
		await ctx.session.hook(
			"compaction",
			safe("experimental.session.compacting", async (event) => {
				const { sessionID } = event;
				const augment = config.promptMode === "augment";

				let previousSummary: string | undefined;
				let latestAsk: string | undefined;
				try {
					// The active context includes the last checkpoint, so both the
					// latest user ask and the previous summary come from one read.
					const list = projectSessionMessages(
						await ctx.session.context({ sessionID }),
					);
					latestAsk = extractLatestUserAsk(list);
					// In replace mode the default prompt (which carries the previous
					// summary) is not used, so fetch and re-inject it ourselves. In
					// augment mode the default prompt already carries it.
					if (!augment) {
						const state = slidingState.get(sessionID) ?? {};
						previousSummary = extractPreviousSummary(list, state);
						slidingState.set(sessionID, state);
					}
				} catch (error) {
					logger.info("message fetch failed", { error: String(error) });
				}

				const tracker = getTracker(sessionID);
				const filesManifest =
					tracker.size > 0 ? tracker.renderManifest() : undefined;
				// Clear tracker after compaction since old operations are now in the summary.
				tracker.clear();

				const text = augment
					? // Keep OpenCode's default prompt and append only the delta (the
						// sections the default summary lacks).
						buildAugmentPrompt({ filesTouched: filesManifest, focus: latestAsk })
					: // The 2.0 host always appends its own summary prompt; state that
						// this template supersedes it so replace mode stays a replace.
						`${buildCompactionPrompt({
							filesTouched: filesManifest,
							previousSummary,
							focus: latestAsk,
						})}\n\nThis template supersedes any other summary template in this request.`;

				event.system.push({ type: "text", text });

				logger.info("compaction triggered", {
					sessionID,
					hasFiles: !!filesManifest,
					mode: config.promptMode,
				});
			}),
		);

		// `experimental.chat.messages.transform` -> `ctx.session.hook("context")`.
		// The 2.0 hook receives wire messages; `projectMessages` bridges them to
		// the `{ info, parts }` view the strategies operate on and writes back.
		await ctx.session.hook(
			"context",
			safe("experimental.chat.messages.transform", async (event) => {
				const projection = projectMessages(event.messages);
				await applyTransform(projection.messages, {
					config,
					logger,
					compressions,
					scorer,
					scorerMaxSamples: config.adapters?.scorer?.maxSamples,
				});
				projection.commit();
			}),
		);

		// V1's `config` hook filled an unset `permission[tool] = "allow"` for the
		// plugin tools. OpenCode 2 has no plugin-mutable global config, and its
		// default agent permission set is already allow-all (apart from `*.env`
		// reads), so no registration is needed.

		// `tool` map -> `ctx.tool.transform`.
		const toolDef = buildCompressToolDef();
		await ctx.tool.transform((editor) => {
			editor.add({
				name: toolDef.name,
				description: toolDef.description,
				input: toolDef.input as unknown as Record<string, unknown>,
				execute: async (input) => ({
					content: await toolDef.execute(input as never),
				}),
			});
		});

		// V1's `event` hook -> `ctx.event.subscribe`; cleanup replaces `dispose`.
		const controller = new AbortController();
		void (async () => {
			try {
				for await (const event of ctx.event.subscribe({
					signal: controller.signal,
					types: ["session.deleted"],
				})) {
					// The runtime may ignore `types`; keep the guard as well.
					if (event.type !== "session.deleted") continue;
					const sessionID =
						typeof event.data?.sessionID === "string"
							? event.data.sessionID
							: undefined;
					if (!sessionID) continue;
					sessionTrackers.delete(sessionID);
					compressions.clear(sessionID);
					slidingState.delete(sessionID);
				}
			} catch (error) {
				if (!controller.signal.aborted) {
					logger.warn("event subscription failed", { error: String(error) });
				}
			}
		})();

		return () => {
			controller.abort();
			sessionTrackers.clear();
			compressions.clearAll();
			slidingState.clear();
		};
	},
};

export default CompactionPlugin;
