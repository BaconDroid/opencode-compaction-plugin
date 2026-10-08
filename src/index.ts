/**
 * opencode-live-compaction — Enhanced context compaction plugin for OpenCode.
 *
 * Features:
 * - 11-section structured summary (vs 7 built-in), replace or augment the default
 * - Previous compaction summary carried forward (<previous-summary>)
 * - Files-touched manifest with operation badges
 * - Todo list captured before compaction and restored after
 * - Deduplication of repeated tool calls
 * - Error purge (whole-attempt + cascade)
 * - Auto-continue control (skips the compaction agent and duplicates)
 * - Hook error isolation
 * - Opt-in preemptive compaction near the context limit
 * - Opt-in post-compaction degradation diagnostic
 * - Model-driven compress/expand tools
 * - Global + project + plugin-option config
 *
 * Usage:
 *   1. Local: copy to `.opencode/plugins/live-compaction.ts`
 *   2. npm: add "opencode-live-compaction" to `plugin` array in opencode.json
 *
 * This file is the wiring only; the logic lives in focused modules:
 *   transform.ts · preemption.ts · prompt.ts · compress.ts · expand.ts ·
 *   strategies.ts · eviction.ts · config.ts · …
 */

import { buildCompactionPrompt, extractLatestUserAsk } from "./core/prompt.js";
import { FilesTouchedTracker } from "./core/files-touched.js";
import { loadConfig } from "./config/config-loader.js";
import type { LiveCompactionConfig } from "./config/config.js";
import { CompressionStore } from "./core/compress.js";
import {
	ExpansionSidecar,
	ExpandStore,
	recordText,
} from "./core/expand.js";
import { EmbeddingVectorIndex, RerankVectorIndex, type VectorIndex } from "./core/adapters.js";
import { resolveEmbedder, resolveReranker, resolveScorer } from "./opencode/adapters.js";
import { createModelRunner } from "./opencode/model.js";
import {
	buildCompressToolDef,
	buildExpandToolDef,
	buildInspectToolDef,
	buildSearchToolDef,
} from "./opencode/tools.js";
import {
	TodoPreserver,
	extractTodos,
	renderTaskState,
	type TodoSnapshot,
} from "./core/todo-preserver.js";
import type { TokenInfo } from "./core/preemption.js";
import {
	DegradationMonitor,
	countTrailingNoTextAssistant,
} from "./core/degradation-monitor.js";
import {
	extractPreviousSummary,
	type SlidingState,
} from "./core/previous-summary.js";
import { PreemptionController } from "./core/preemption.js";
import { applyTransform } from "./core/transform.js";
import type { Hooks, Logger, Plugin, PluginInput } from "./types.js";

/** Model-driven tools registered by this plugin (used for permission wiring). */
const PLUGIN_TOOL_NAMES = [
	"compress",
	"expand",
	"inspect",
	"search",
] as const;

function makeLogger(
	client: PluginInput["client"],
	enabled: boolean,
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
				service: "live-compaction",
				level,
				message,
				extra: data as Record<string, unknown> | undefined,
			},
		}).catch(() => {});
	};
	return {
		info: (message, data) => {
			if (enabled) log("info", message, data);
		},
		warn: (message, data) => {
			if (enabled) log("warn", message, data);
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

export const LiveCompactionPlugin: Plugin = async (ctx, options) => {
	// Load config (defaults < global file < plugin options < project file).
	const configWarnings: string[] = [];
	const config = loadConfig(
		ctx.directory,
		(message) => configWarnings.push(message),
		options as LiveCompactionConfig | undefined,
	);
	const logger = makeLogger(ctx.client, config.debug ?? false);

	// Surface config problems regardless of the debug flag.
	for (const warning of configWarnings) {
		void ctx.client.app.log({
			body: { service: "live-compaction", level: "warn", message: warning },
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
	const expansions = new ExpansionSidecar();
	const expandStore = new ExpandStore();
	const todoPreserver = new TodoPreserver();
	const slidingState = new Map<string, SlidingState>();
	const degradation = new DegradationMonitor();
	const autocontinue = new AutocontinueGuard();
	const preemption = new PreemptionController(
		ctx.client,
		ctx.directory,
		config,
		logger,
	);

	// Optional retrieval + scorer adapters (opt-in). The model runner is shared
	// by the opencode-provider adapters so their calls cannot nest.
	const adapterDeps = {
		logger,
		modelRunner: createModelRunner(ctx.client, ctx.directory),
	};
	const corpus = (sessionID?: string) =>
		expansions.listForSession(sessionID).map((record) => ({
			id: record.id,
			text: recordText(record),
		}));

	// Semantic retrieval: vector embeddings first, else a model reranker. When
	// absent or unusable the `search` tool keeps its deterministic keyword search.
	const embeddingCfg = config.adapters?.embeddings;
	const rerankCfg = config.adapters?.rerank;
	const embedder = resolveEmbedder(embeddingCfg, adapterDeps);
	let semanticIndex: VectorIndex | undefined;
	if (embedder) {
		semanticIndex = new EmbeddingVectorIndex(
			embedder,
			corpus,
			embeddingCfg?.minScore ?? 0,
		);
		logger.info("semantic search adapter enabled", {
			provider: embeddingCfg?.provider ?? "http",
		});
	} else {
		const reranker = resolveReranker(rerankCfg, adapterDeps);
		if (reranker) {
			semanticIndex = new RerankVectorIndex(
				reranker,
				corpus,
				rerankCfg?.maxCandidates,
			);
			logger.info("rerank search adapter enabled", {
				model: rerankCfg?.model ?? "opencode/big-pickle",
			});
		}
	}

	// Optional residual/perplexity scorer (opt-in) for the eviction budget (E5).
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

	// Restore a captured todo snapshot after compaction. The writer is an
	// OpenCode internal module, so this is best-effort.
	const restoreTodos = async (sessionID: string): Promise<void> => {
		const snapshot = todoPreserver.take(sessionID);
		if (!snapshot || snapshot.length === 0) return;
		try {
			// Loaded through a variable so TypeScript does not resolve the path.
			const loader = "opencode/session/todo";
			const mod = (await import(loader)) as {
				Todo?: {
					update?: (input: {
						sessionID: string;
						todos: TodoSnapshot[];
					}) => Promise<void>;
				};
			};
			const update = mod.Todo?.update;
			if (typeof update !== "function") return;
			await update({ sessionID, todos: snapshot });
			logger.info("todos restored", { sessionID, count: snapshot.length });
		} catch (error) {
			logger.info("todo restore failed", { error: String(error) });
		}
	};

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
				if (await preemption.isCompressEligible(sessionID)) {
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
				} else {
					logger.info("compress deferred (usage below threshold)", {
						sessionID,
						topic: a.topic,
					});
				}
			}

			if (tool === "expand" && typeof a.block === "string") {
				const mode = a.mode === "once" ? "once" : "sticky";
				expandStore.queue(sessionID, {
					block: a.block,
					mode,
					callID: input.callID,
					timestamp: Date.now(),
				});
				logger.info("expand queued", {
					sessionID,
					block: a.block,
					mode,
				});
			}

			// Proactive compaction check (opt-in). Fire-and-forget so a slow
			// summarize never blocks the tool result.
			void preemption.maybePreempt(sessionID).catch(() => {});
		},

		"experimental.session.compacting": async (input, output) => {
			const { sessionID } = input;

			// Capture the todo list so it can be restored after compaction.
			const todoClient = ctx.client.session?.todo;
			if (todoClient) {
				try {
					todoPreserver.capture(
						sessionID,
						extractTodos(await todoClient({ path: { id: sessionID } })),
					);
				} catch (error) {
					logger.info("todo capture failed", { error: String(error) });
				}
			}

			// In replace mode the default prompt (which carries the previous
			// summary) is discarded, so fetch and re-inject it ourselves.
			const wantSummary = config.promptMode !== "augment";

			let previousSummary: string | undefined;
			let latestAsk: string | undefined;
			const fetchMessages = ctx.client.session?.messages;
			if (fetchMessages && wantSummary) {
				try {
					const response = await fetchMessages({ path: { id: sessionID } });
					const list = unwrapList(response);
					const state = slidingState.get(sessionID) ?? {};
					previousSummary = extractPreviousSummary(list, state);
					latestAsk = extractLatestUserAsk(list);
					slidingState.set(sessionID, state);
				} catch (error) {
					logger.info("message fetch failed", { error: String(error) });
				}
			}

			// Render the captured task state (IDs/statuses preserved).
			const todoSnapshot = todoPreserver.peek(sessionID);
			const taskState =
				todoSnapshot && todoSnapshot.length > 0
					? renderTaskState(todoSnapshot)
					: undefined;

			const tracker = getTracker(sessionID);
			const filesManifest =
				tracker.size > 0 ? tracker.renderManifest() : undefined;
			// Clear tracker after compaction since old operations are now in the summary.
			tracker.clear();

			const enhancedPrompt = buildCompactionPrompt({
				filesTouched: filesManifest,
				previousSummary,
				taskState,
				focus: latestAsk,
			});

			if (config.promptMode === "augment") {
				// Keep OpenCode's default prompt and append our instructions.
				output.context.push(enhancedPrompt);
			} else {
				// Replace the default compaction prompt entirely.
				output.prompt = enhancedPrompt;
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
				expansions,
				expandStore,
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
						info?: {
							id?: string;
							sessionID?: string;
							role?: string;
							providerID?: string;
							modelID?: string;
							finish?: unknown;
							tokens?: TokenInfo;
						};
					}
				| undefined;
			const sessionID =
				props?.sessionID ?? props?.info?.id ?? props?.info?.sessionID;

			if (event.type === "session.deleted") {
				if (sessionID) {
					sessionTrackers.delete(sessionID);
					compressions.clear(sessionID);
					expansions.clear(sessionID);
					expandStore.clear(sessionID);
					// Drop this session's cached embeddings (not every session's).
					semanticIndex?.clearSession?.(sessionID);
					todoPreserver.clear(sessionID);
					slidingState.delete(sessionID);
					preemption.clear(sessionID);
					degradation.clear(sessionID);
					autocontinue.clear(sessionID);
				}
				return;
			}

			if (event.type === "session.compacted") {
				if (sessionID) {
					degradation.markCompacted(sessionID, Date.now());
					await restoreTodos(sessionID);
				}
				return;
			}

			if (event.type === "message.updated") {
				const info = props?.info;
				if (
					info?.role === "assistant" &&
					info.finish &&
					info.sessionID &&
					info.providerID &&
					info.tokens
				) {
					preemption.recordUsage(
						info.sessionID,
						info.providerID,
						info.modelID ?? "",
						info.tokens,
					);
					// Check on turn end too, so text-only sessions still trigger.
					void preemption.maybePreempt(info.sessionID).catch(() => {});
				}

				// Post-compaction degradation diagnostic (opt-in).
				const cfgDeg = config.degradationMonitor;
				if (
					cfgDeg?.enabled &&
					info?.role === "assistant" &&
					info.finish &&
					info.sessionID &&
					degradation.shouldCheck(info.sessionID, Date.now(), cfgDeg.windowMs)
				) {
					const fetchMessages = ctx.client.session?.messages;
					if (fetchMessages) {
						try {
							const response = await fetchMessages({
								path: { id: info.sessionID },
							});
							const list = unwrapList(response);
							const count = countTrailingNoTextAssistant(
								list as Array<{
									info?: { role?: string };
									parts?: unknown;
								}>,
							);
							if (count >= cfgDeg.threshold) {
								logger.info("post-compaction degradation detected", {
									sessionID: info.sessionID,
									consecutiveNoText: count,
								});
								degradation.clear(info.sessionID);
							}
						} catch (error) {
							logger.info("degradation check failed", {
								error: String(error),
							});
						}
					}
				}
				return;
			}
		},

		dispose: async () => {
			sessionTrackers.clear();
			compressions.clearAll();
			expansions.clearAll();
			expandStore.clearAll();
			semanticIndex?.clear?.();
			todoPreserver.clearAll();
			slidingState.clear();
			preemption.clearAll();
			degradation.clearAll();
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
			expand: buildExpandToolDef(),
			inspect: buildInspectToolDef(expansions),
			search: buildSearchToolDef(
				expansions,
				config.compress?.searchMaxResults ?? 5,
				semanticIndex ? { index: semanticIndex, logger } : undefined,
			),
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

export default LiveCompactionPlugin;
