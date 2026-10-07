/**
 * opencode-live-compaction — Enhanced context compaction plugin for OpenCode.
 *
 * Features:
 * - 11-section structured summary (vs 7 built-in), replace or augment the default
 * - Previous compaction summary carried forward (<previous-summary>)
 * - Files-touched manifest with operation badges
 * - Todo list captured before compaction and restored after
 * - Tool output trimming (configurable per-tool limits)
 * - Protected file patterns (never trim matching files)
 * - Turn protection (protect recent tool outputs from trimming)
 * - Deduplication of repeated tool calls
 * - Error input purging
 * - Auto-continue control (skips the compaction agent and duplicates)
 * - Hook error isolation
 * - Opt-in preemptive compaction near the context limit
 * - Opt-in post-compaction degradation diagnostic
 * - Model-driven compress tool
 * - Global + project + plugin-option config
 *
 * Usage:
 *   1. Local: copy to `.opencode/plugins/live-compaction.ts`
 *   2. npm: add "opencode-live-compaction" to `plugin` array in opencode.json
 */

import {
	buildCompactionPrompt,
	extractLatestUserAsk,
} from "./prompt.js";
import { FilesTouchedTracker } from "./files-touched.js";
import { loadConfig, type LiveCompactionConfig } from "./config.js";
import {
	applyDedup,
	applyPurgeErrors,
	applyCascadePurge,
} from "./strategies.js";
import { applyEviction } from "./eviction.js";
import { extractFilePaths, isFileProtected } from "./glob.js";
import {
	buildCompressToolDef,
	buildSquashToolDef,
	CompressionStore,
	SquashStore,
	applyCompressions,
	applySquash,
	selectCompressions,
} from "./compress.js";
import {
	ExpansionSidecar,
	ExpandStore,
	applyExpansions,
	buildExpandToolDef,
	buildRecallToolDef,
} from "./expand.js";
import {
	TodoPreserver,
	extractTodos,
	renderTaskState,
	type TodoSnapshot,
} from "./todo-preserver.js";
import {
	effectiveInputTokens,
	resolveTriggerThreshold,
	shouldTriggerPreemptiveCompaction,
	type CachedUsage,
	type TokenInfo,
} from "./preemptive-compaction.js";
import {
	DegradationMonitor,
	countTrailingNoTextAssistant,
} from "./degradation-monitor.js";
import {
	extractPreviousSummary,
	type SlidingState,
} from "./previous-summary.js";
import type { Message, MessagePart } from "./types.js";

// ---------------------------------------------------------------------------
// Types — inlined from @opencode-ai/plugin to avoid requiring it as a dep.
// These match the Hooks interface and Plugin type at runtime.
// ---------------------------------------------------------------------------

interface PluginInput {
	client: {
		app: {
			log: (input: {
				body: {
					service: string;
					level: "debug" | "info" | "warn" | "error";
					message: string;
					extra?: Record<string, unknown>;
				};
			}) => Promise<unknown>;
		};
		session?: {
			todo?: (input: { path: { id: string } }) => Promise<unknown>;
			messages?: (input: { path: { id: string } }) => Promise<unknown>;
			summarize?: (input: {
				path: { id: string };
				body: { providerID: string; modelID: string; auto?: boolean };
				query: { directory: string };
			}) => Promise<unknown>;
		};
		provider?: {
			list?: (input?: Record<string, unknown>) => Promise<unknown>;
		};
	};
	project: { id: string; name: string };
	directory: string;
	worktree: string;
	serverUrl: URL;
}

type Plugin = (
	input: PluginInput,
	options?: Record<string, unknown>,
) => Promise<Hooks>;

interface Hooks {
	dispose?: () => Promise<void>;
	event?: (input: {
		event: { id: string; type: string; properties: unknown };
	}) => Promise<void>;
	"tool.execute.after"?: (
		input: { tool: string; sessionID: string; callID: string; args: unknown },
		output: { title: string; output: string; metadata: unknown },
	) => Promise<void>;
	"experimental.session.compacting"?: (
		input: { sessionID: string },
		output: { context: string[]; prompt?: string },
	) => Promise<void>;
	"experimental.compaction.autocontinue"?: (
		input: { sessionID?: string; agent?: string; [key: string]: unknown },
		output: { enabled: boolean },
	) => Promise<void>;
	"experimental.chat.messages.transform"?: (
		input: Record<string, never>,
		output: { messages: Message[] },
	) => Promise<void>;
	config?: (config: Record<string, unknown>) => Promise<void>;
	tool?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Per-instance state lives inside LiveCompactionPlugin so it is not shared
// between plugin instances in the same process.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tool output trimming (uses config limits + protected patterns + turn protection)
// ---------------------------------------------------------------------------

function buildTrimMap(config: LiveCompactionConfig): Record<string, number> {
	return {
		bash: config.trim?.bash ?? 600,
		write: config.trim?.write ?? 100,
		edit: config.trim?.edit ?? 100,
		delete: config.trim?.delete ?? 50,
		read: config.trim?.read ?? 300,
		glob: config.trim?.glob ?? 200,
		grep: config.trim?.grep ?? 400,
		list: config.trim?.list ?? 200,
	};
}

const TRIMMED_MARKER = /\n\.\.\. \[trimmed \d+\/\d+ chars\]$/;

function trimToolOutput(
	toolName: string,
	output: string,
	trimMap: Record<string, number>,
	defaultLimit: number,
): string {
	// Already trimmed in a previous transform pass: leave it as-is so the
	// retained tail is not re-sliced and eroded on every message batch.
	if (TRIMMED_MARKER.test(output)) return output;

	const limit = trimMap[toolName] ?? defaultLimit;
	if (output.length <= limit) return output;

	const indicator = `\n... [trimmed ${output.length - limit}/${output.length} chars]`;
	// Keep the END of output (usually has the important result/error)
	return output.slice(-limit) + indicator;
}

/**
 * Count user message boundaries from the end of the messages array.
 * Returns a set of message indices that fall within the last N user turns.
 */
function getRecentTurnIndices(
	messages: Message[],
	protectedTurns: number,
): Set<number> {
	const recentIndices = new Set<number>();
	if (protectedTurns <= 0) return recentIndices;
	let userTurnsFromEnd = 0;

	// Walk backwards from the end
	for (let i = messages.length - 1; i >= 0; i--) {
		recentIndices.add(i);

		if (messages[i].info.role === "user") {
			userTurnsFromEnd++;
			if (userTurnsFromEnd >= protectedTurns) {
				break;
			}
		}
	}

	return recentIndices;
}

/**
 * Check if a tool part's args contain a file path matching protected patterns.
 */
function hasProtectedFilePath(
	part: MessagePart,
	protectedPatterns: string[],
): boolean {
	if (protectedPatterns.length === 0) return false;

	// Mirror the dedup lookup: args may live under `args` or `state.input`,
	// and `state.input` may be a JSON string.
	const raw = (part as Record<string, unknown>).args ?? part.state?.input;
	let args: Record<string, unknown> | undefined;
	if (typeof raw === "string") {
		try {
			args = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			args = undefined;
		}
	} else if (raw && typeof raw === "object") {
		args = raw as Record<string, unknown>;
	}
	if (!args) return false;

	const paths = extractFilePaths(part.tool ?? "", args);
	return isFileProtected(paths, protectedPatterns);
}

// ---------------------------------------------------------------------------
// Logger helper
// ---------------------------------------------------------------------------

function makeLogger(client: PluginInput["client"], enabled: boolean) {
	return {
		info: (msg: string, data?: unknown) => {
			if (enabled) {
				client.app.log({
					body: {
						service: "live-compaction",
						level: "info",
						message: msg,
						extra: data as Record<string, unknown> | undefined,
					},
				});
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/** Model-driven tools registered by this plugin (used for permission wiring). */
const PLUGIN_TOOL_NAMES = ["compress", "squash", "expand", "recall"] as const;

export const LiveCompactionPlugin: Plugin = async (ctx, options) => {
	// Load config (defaults < global file < plugin options < project file)
	const configWarnings: string[] = [];
	const config = loadConfig(
		ctx.directory,
		(message) => {
			configWarnings.push(message);
		},
		options as LiveCompactionConfig | undefined,
	);
	const logger = makeLogger(ctx.client, config.debug ?? false);

	// Surface config problems regardless of the debug flag.
	for (const warning of configWarnings) {
		ctx.client.app.log({
			body: { service: "live-compaction", level: "warn", message: warning },
		});
	}

	// Kill switch: `enabled: false` disables every hook.
	if (!config.enabled) {
		logger.info("plugin disabled via config");
		return {};
	}

	// Build trim limits map once
	const trimMap = buildTrimMap(config);
	const defaultTrim = config.trim?.default ?? 500;
	const protectedPatterns = config.protectedFilePatterns ?? [];
	const turnProtectionEnabled = config.turnProtection?.enabled ?? true;
	const protectedTurns = config.turnProtection?.turns ?? 4;

	logger.info("initialized", {
		dedup: config.dedup?.enabled,
		purgeErrors: config.purgeErrors?.enabled,
		protectedPatterns: protectedPatterns.length,
		turnProtection: turnProtectionEnabled ? protectedTurns : "off",
	});

	// Per-instance state
	const sessionTrackers = new Map<string, FilesTouchedTracker>();
	const compressions = new CompressionStore();
	const squashes = new SquashStore();
	const expansions = new ExpansionSidecar();
	const expandStore = new ExpandStore();
	const todoPreserver = new TodoPreserver();
	const slidingState = new Map<string, SlidingState>();
	const preemptUsage = new Map<string, CachedUsage>();
	const preemptInProgress = new Set<string>();
	const preemptLast = new Map<string, number>();
	// Counters since the last proactive compaction (deterministic gates).
	const preemptTokensAtLast = new Map<string, number>();
	const preemptToolCallsSince = new Map<string, number>();
	const preemptMessagesSince = new Map<string, number>();
	const contextLimitCache = new Map<string, number>();
	const degradation = new DegradationMonitor();

	const getTracker = (sessionID: string): FilesTouchedTracker => {
		let tracker = sessionTrackers.get(sessionID);
		if (!tracker) {
			tracker = new FilesTouchedTracker();
			sessionTrackers.set(sessionID, tracker);
		}
		return tracker;
	};

	// Deferred compression requests older than this are dropped (N2).
	const DEFERRED_COMPRESSION_MAX_AGE_MS = 30 * 60 * 1000;

	// Isolate hook failures: a thrown error is logged and swallowed so it cannot
	// break compaction or the message pipeline.
	const safe = <T extends (...args: any[]) => any>(name: string, fn: T): T =>
		(async (...args: Parameters<T>) => {
			try {
				return await fn(...args);
			} catch (error) {
				logger.info(`hook error: ${name}`, { error: String(error) });
				return undefined;
			}
		}) as T;

	// Autocontinue hardening: never auto-continue for the compaction agent, and
	// suppress duplicate auto-continue for the same session within a short window.
	const AUTOCONTINUE_GUARD_MS = 10_000;
	const autocontinueGuard = new Map<string, ReturnType<typeof setTimeout>>();
	const markAutocontinue = (sessionID: string) => {
		const existing = autocontinueGuard.get(sessionID);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(
			() => autocontinueGuard.delete(sessionID),
			AUTOCONTINUE_GUARD_MS,
		);
		(timer as { unref?: () => void }).unref?.();
		autocontinueGuard.set(sessionID, timer);
	};
	const clearAutocontinueGuard = (sessionID: string) => {
		const timer = autocontinueGuard.get(sessionID);
		if (timer) clearTimeout(timer);
		autocontinueGuard.delete(sessionID);
	};

	// Restore a captured todo snapshot after compaction. The writer is an
	// OpenCode internal module, so this is best-effort.
	const restoreTodos = async (sessionID: string): Promise<void> => {
		const snapshot = todoPreserver.take(sessionID);
		if (!snapshot || snapshot.length === 0) return;
		try {
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

	// Resolve the model context limit: config override first, else the provider
	// catalog. Cached per provider/model.
	const resolveContextLimit = async (
		providerID: string,
		modelID: string,
	): Promise<number | undefined> => {
		const override = config.preemptiveCompaction?.contextLimit;
		if (typeof override === "number" && override > 0) return override;

		const key = `${providerID}/${modelID}`;
		const cached = contextLimitCache.get(key);
		if (cached !== undefined) return cached;

		const list = ctx.client.provider?.list;
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
				contextLimitCache.set(key, limit);
				return limit;
			}
		} catch (error) {
			logger.info("context limit resolution failed", { error: String(error) });
		}
		return undefined;
	};

	// Eligibility gate for the model-driven `compress` tool: when proactive
	// compaction is enabled, defer a compression requested far below the
	// compaction threshold (deterministic, no model call). Manual use without
	// preemptive compaction enabled is never gated.
	const isCompressEligible = async (sessionID: string): Promise<boolean> => {
		const cfg = config.preemptiveCompaction;
		if (!cfg?.enabled) return true;
		const usage = preemptUsage.get(sessionID);
		if (!usage) return true;
		const limit = await resolveContextLimit(usage.providerID, usage.modelID);
		if (limit === undefined) return true;
		const effective = effectiveInputTokens(
			usage.tokens,
			cfg.countCacheTokens ?? false,
		);
		const thresholdTokens = resolveTriggerThreshold(limit, cfg);
		return effective >= thresholdTokens * 0.5;
	};

	// Trigger proactive compaction when the reported usage nears the limit.
	const maybePreempt = async (sessionID: string): Promise<void> => {
		const cfg = config.preemptiveCompaction;
		if (!cfg?.enabled) return;
		const usage = preemptUsage.get(sessionID);
		if (!usage) return;
		if (preemptInProgress.has(sessionID)) return;

		const limit = await resolveContextLimit(usage.providerID, usage.modelID);
		if (limit === undefined) return;

		const effectiveTokens = effectiveInputTokens(
			usage.tokens,
			cfg.countCacheTokens ?? false,
		);
		const thresholdTokens = resolveTriggerThreshold(limit, cfg);
		const baseline = preemptTokensAtLast.get(sessionID);

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
			messagesSinceLast: preemptMessagesSince.get(sessionID) ?? 0,
			tailGuard: cfg.tailGuard,
			newToolCallsSinceLast: preemptToolCallsSince.get(sessionID) ?? 0,
			cooldownMs: cfg.cooldownMs,
			now: Date.now(),
			lastCompactionAt: preemptLast.get(sessionID),
			inProgress: false,
		});
		if (!trigger) return;

		const summarize = ctx.client.session?.summarize;
		if (!summarize) return;

		preemptInProgress.add(sessionID);
		preemptLast.set(sessionID, Date.now());
		// Reset the deterministic gates for the next cycle.
		preemptTokensAtLast.set(sessionID, effectiveTokens);
		preemptToolCallsSince.set(sessionID, 0);
		preemptMessagesSince.set(sessionID, 0);
		try {
			await summarize({
				path: { id: sessionID },
				body: {
					providerID: usage.providerID,
					modelID: usage.modelID,
					auto: true,
				},
				query: { directory: ctx.directory },
			});
			logger.info("preemptive compaction triggered", {
				sessionID,
				ratio: effectiveTokens / limit,
			});
		} catch (error) {
			logger.info("preemptive compaction failed", { error: String(error) });
		} finally {
			preemptInProgress.delete(sessionID);
		}
	};

	const hooks: Hooks = {
		// -----------------------------------------------------------------------
		// Track file operations + capture compress tool calls
		// -----------------------------------------------------------------------
		"tool.execute.after": async (input, _output) => {
			const { tool, sessionID, args } = input;
			if (!sessionID || !args) return;

			// Deterministic gate: count tool calls since the last compaction.
			preemptToolCallsSince.set(
				sessionID,
				(preemptToolCallsSince.get(sessionID) ?? 0) + 1,
			);

			// Track file operations
			const tracker = getTracker(sessionID);
			tracker.processToolCall(tool, args as Record<string, unknown>);

			// Capture compress tool calls
			if (tool === "compress") {
				const a = args as Record<string, unknown>;
				if (typeof a.topic === "string" && typeof a.summary === "string") {
					const start = typeof a.start === "number" ? a.start : undefined;
					const end = typeof a.end === "number" ? a.end : undefined;
					const scale =
						a.scale === "granular" || a.scale === "deep"
							? a.scale
							: undefined;
					const eligible = await isCompressEligible(sessionID);
					if (!eligible) {
						logger.info("compress deferred (usage below threshold)", {
							sessionID,
							topic: a.topic,
						});
					} else {
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
				}
			}

			// Capture squash tool calls
			if (tool === "squash") {
				const a = args as Record<string, unknown>;
				if (
					typeof a.from === "string" &&
					typeof a.to === "string" &&
					typeof a.topic === "string" &&
					typeof a.summary === "string"
				) {
					squashes.queue(sessionID, {
						from: a.from,
						to: a.to,
						topic: a.topic,
						summary: a.summary,
						timestamp: Date.now(),
						callID: input.callID,
					});
					logger.info("squash queued", {
						sessionID,
						from: a.from,
						to: a.to,
					});
				}
			}

			// Capture expand / recall tool calls
			if (tool === "expand" || tool === "recall") {
				const a = args as Record<string, unknown>;
				if (typeof a.block === "string") {
					expandStore.queue(sessionID, {
						block: a.block,
						mode: tool === "expand" ? "sticky" : "once",
						callID: input.callID,
						timestamp: Date.now(),
					});
					logger.info("expand queued", {
						sessionID,
						block: a.block,
						mode: tool,
					});
				}
			}

			// Proactive compaction check (opt-in). Fire-and-forget so a slow
			// summarize never blocks the tool result.
			void maybePreempt(sessionID);
		},

		// -----------------------------------------------------------------------
		// Enhanced compaction: replace or augment the default compaction prompt
		// -----------------------------------------------------------------------
		"experimental.session.compacting": async (input, output) => {
			const { sessionID } = input;

			// Capture the todo list so it can be restored after compaction.
			const todoClient = ctx.client.session?.todo;
			if (todoClient) {
				try {
					const response = await todoClient({ path: { id: sessionID } });
					todoPreserver.capture(sessionID, extractTodos(response));
				} catch (error) {
					logger.info("todo capture failed", { error: String(error) });
				}
			}

			// In replace mode the default prompt (which carries the previous
			// summary) is discarded, so fetch and re-inject it ourselves.
			let previousSummary: string | undefined;
			let latestAsk: string | undefined;
			if (config.promptMode !== "augment") {
				const fetchMessages = ctx.client.session?.messages;
				if (fetchMessages) {
					try {
						const response = await fetchMessages({
							path: { id: sessionID },
						});
						const list = Array.isArray(response)
							? response
							: (((response as { data?: unknown })?.data as
									| unknown[]
									| undefined) ?? []);
						const state = slidingState.get(sessionID) ?? {};
						previousSummary = extractPreviousSummary(list, state);
						latestAsk = extractLatestUserAsk(list);
						slidingState.set(sessionID, state);
					} catch (error) {
						logger.info("previous summary fetch failed", {
							error: String(error),
						});
					}
				}
			}

			// Render the captured task state (IDs/statuses preserved).
			const todoSnapshot = todoPreserver.peek(sessionID);
			const taskState =
				todoSnapshot && todoSnapshot.length > 0
					? renderTaskState(todoSnapshot)
					: undefined;

			// Collect files-touched manifest
			const tracker = getTracker(sessionID);
			const filesManifest =
				tracker.size > 0 ? tracker.renderManifest() : undefined;

			// Clear tracker after compaction since old operations are now in the summary
			tracker.clear();

			// Build the enhanced prompt
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

		// -----------------------------------------------------------------------
		// Compress + trim + dedup + purge + protected patterns + turn protection
		// Runs BEFORE OpenCode's own 2000-char truncation.
		// -----------------------------------------------------------------------
		"experimental.chat.messages.transform": async (_input, output) => {
			const messages = output.messages;

			// 0. Apply pending compression/squash/expand requests.
			// The transform hook receives no session id, so a compression is scoped
			// by the callID of its compress tool call: a request queued for one
			// session is never applied to another. Non-matching requests stay queued
			// until they expire.
			for (const sid of sessionTrackers.keys()) {
				// 0a. Compressions.
				const requests = compressions.drain(sid);
				if (requests.length > 0) {
					const { applicable, deferred } = selectCompressions(
						messages,
						requests,
					);

					if (applicable.length > 0) {
						const reversible = config.compress?.reversible ?? true;
						const replaced = applyCompressions(
							messages,
							applicable,
							{
								protectedTurns: config.compress?.protectedTurns ?? 3,
								record: reversible
									? ({ id, original }) =>
											expansions.save(sid, id, original as unknown[])
									: undefined,
							},
						);
						if (replaced > 0) {
							logger.info("compress applied", {
								sessionID: sid,
								messagesReplaced: replaced,
							});
						}
					}

					// Re-queue requests for a different conversation, unless stale.
					const now = Date.now();
					for (const req of deferred) {
						if (now - req.timestamp < DEFERRED_COMPRESSION_MAX_AGE_MS) {
							compressions.queue(sid, req);
						} else {
							logger.info("compress deferred request expired", {
								sessionID: sid,
								topic: req.topic,
							});
						}
					}
				}

				// 0b. Squash contiguous blocks.
				const squashRequests = squashes.drain(sid);
				if (squashRequests.length > 0) {
					const merged = applySquash(
						messages,
						squashRequests,
						{ maxBlocks: config.compress?.maxBlocksPerSquash ?? 8 },
					);
					if (merged > 0) {
						logger.info("squash applied", {
							sessionID: sid,
							blocksMerged: merged,
						});
					}
				}

				// 0c. Expand compressed blocks back to their originals.
				const expandRequests = expandStore.drain(sid);
				if (expandRequests.length > 0) {
					const { expanded, unmatched } = applyExpansions(
						messages,
						expandRequests,
						expansions,
					);
					if (expanded > 0) {
						logger.info("expand applied", { sessionID: sid, expanded });
					}
					if (unmatched.length > 0) {
						logger.info("expand unmatched", {
							sessionID: sid,
							blocks: unmatched,
						});
					}
				}
			}

			// 1. Compute turn-protected indices (messages within last N user turns)
			const recentIndices = turnProtectionEnabled
				? getRecentTurnIndices(messages, protectedTurns)
				: new Set<number>();

			// 2. Trim tool outputs with protection checks
			for (let mi = 0; mi < messages.length; mi++) {
				const msg = messages[mi];
				for (const part of msg.parts) {
					if (
						part.type !== "tool" ||
						!part.state ||
						typeof part.state.output !== "string" ||
						!part.tool
					) {
						continue;
					}

					// Skip if within protected turn window
					if (recentIndices.has(mi)) continue;

					// Skip if file path matches protected patterns
					if (hasProtectedFilePath(part, protectedPatterns)) continue;

					part.state.output = trimToolOutput(
						part.tool,
						part.state.output,
						trimMap,
						defaultTrim,
					);
				}
			}

			// 3. Dedup repeated tool calls
			if (config.dedup?.enabled) {
				const deduped = applyDedup(
					messages,
					config,
				);
				if (deduped > 0) {
					logger.info("dedup applied", { count: deduped });
				}
			}

			// 4. Purge errored tool inputs (older than purgeErrors.turns)
			if (config.purgeErrors?.enabled) {
				const purgeProtected = getRecentTurnIndices(
					messages,
					config.purgeErrors.turns ?? 4,
				);
				const purgedCallIds = new Set<string>();
				const purged = applyPurgeErrors(
					messages,
					config,
					purgeProtected,
					purgedCallIds,
				);
				if (purged > 0) {
					logger.info("error purge applied", { count: purged });
				}

				// 4b. Cascade the purge to work depending on purged calls.
				if ((config.purgeErrors.cascade ?? true) && purgedCallIds.size > 0) {
					const cascaded = applyCascadePurge(
						messages,
						purgedCallIds,
						purgeProtected,
					);
					if (cascaded > 0) {
						logger.info("cascade purge applied", { count: cascaded });
					}
				}
			}

			// 5. Graduated eviction (runs last; content-addressed, never user turns).
			if (config.eviction?.enabled) {
				const { removed, evictedIds } = applyEviction(
					messages,
					{
						enabled: true,
						thresholdTokens: config.eviction.thresholdTokens ?? 80000,
						levels: config.eviction.levels,
						protectPrologue: config.eviction.protectPrologue ?? true,
					},
				);
				if (removed > 0) {
					logger.info("eviction applied", {
						removed,
						ids: evictedIds.length,
					});
				}
			}
		},

		// -----------------------------------------------------------------------
		// Auto-continue: enabled after compaction, except for the compaction agent
		// and duplicate triggers.
		// -----------------------------------------------------------------------
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
				if (autocontinueGuard.has(sessionID)) {
					output.enabled = false;
					logger.info("autocontinue suppressed (duplicate)");
					return;
				}
				markAutocontinue(sessionID);
			}

			output.enabled = true;
		},

		// -----------------------------------------------------------------------
		// Cleanup on session events
		// -----------------------------------------------------------------------
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
					squashes.clear(sessionID);
					expansions.clear(sessionID);
					expandStore.clear(sessionID);
					todoPreserver.clear(sessionID);
					slidingState.delete(sessionID);
					preemptUsage.delete(sessionID);
					preemptInProgress.delete(sessionID);
					preemptLast.delete(sessionID);
					preemptTokensAtLast.delete(sessionID);
					preemptToolCallsSince.delete(sessionID);
					preemptMessagesSince.delete(sessionID);
					degradation.clear(sessionID);
					clearAutocontinueGuard(sessionID);
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
					preemptUsage.set(info.sessionID, {
						providerID: info.providerID,
						modelID: info.modelID ?? "",
						tokens: info.tokens,
					});
					// Deterministic gate: count completed assistant turns.
					preemptMessagesSince.set(
						info.sessionID,
						(preemptMessagesSince.get(info.sessionID) ?? 0) + 1,
					);
					// Check on turn end too, so text-only sessions still trigger.
					void maybePreempt(info.sessionID);
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
							const list = Array.isArray(response)
								? response
								: (((response as { data?: unknown })?.data as
										| unknown[]
										| undefined) ?? []);
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

		// -----------------------------------------------------------------------
		// Dispose: clean up all state
		// -----------------------------------------------------------------------
		dispose: async () => {
			sessionTrackers.clear();
			compressions.clearAll();
			squashes.clearAll();
			expansions.clearAll();
			expandStore.clearAll();
			todoPreserver.clearAll();
			slidingState.clear();
			preemptUsage.clear();
			preemptInProgress.clear();
			preemptLast.clear();
			preemptTokensAtLast.clear();
			preemptToolCallsSince.clear();
			preemptMessagesSince.clear();
			contextLimitCache.clear();
			degradation.clearAll();
			for (const timer of autocontinueGuard.values()) clearTimeout(timer);
			autocontinueGuard.clear();
		},

		// -----------------------------------------------------------------------
		// Config: ensure the compress tool is permitted
		// -----------------------------------------------------------------------
		config: async (opencodeConfig: Record<string, unknown>) => {
			// Ensure this plugin's model-driven tools are permitted, without
			// clobbering a global permission string (e.g. "permission": "allow") or
			// an explicit deny.
			const permission = opencodeConfig.permission;
			if (typeof permission !== "string") {
				const map = (permission as Record<string, unknown> | undefined) ?? {};
				const next: Record<string, unknown> = { ...map };
				let changed = false;
				for (const toolName of PLUGIN_TOOL_NAMES) {
					if (next[toolName] !== "deny") {
						next[toolName] = "allow";
						changed = true;
					}
				}
				if (changed) opencodeConfig.permission = next;
			}
			// The built-in `/compact` command is intentionally left untouched.
		},

		// -----------------------------------------------------------------------
		// Compress tool definition
		// -----------------------------------------------------------------------
		// The `tool` hook maps a tool name to its definition.
		tool: {
			compress: buildCompressToolDef(),
			squash: buildSquashToolDef(),
			expand: buildExpandToolDef(),
			recall: buildRecallToolDef(),
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
