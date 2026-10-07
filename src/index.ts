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

import { buildCompactionPrompt } from "./prompt.js";
import { FilesTouchedTracker } from "./files-touched.js";
import { loadConfig, type LiveCompactionConfig } from "./config.js";
import { applyDedup, applyPurgeErrors } from "./strategies.js";
import { extractFilePaths, isFileProtected } from "./glob.js";
import {
	buildCompressToolDef,
	CompressionStore,
	applyCompressions,
	selectCompressions,
} from "./compress.js";
import {
	TodoPreserver,
	extractTodos,
	type TodoSnapshot,
} from "./todo-preserver.js";
import {
	totalInputTokens,
	shouldTriggerPreemptiveCompaction,
	type CachedUsage,
	type TokenInfo,
} from "./preemptive-compaction.js";
import {
	DegradationMonitor,
	countTrailingNoTextAssistant,
} from "./degradation-monitor.js";
import { extractPreviousSummary } from "./previous-summary.js";

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

interface MessagePart {
	type: string;
	tool?: string;
	callID?: string;
	state?: {
		status?: string;
		output?: string;
		input?: unknown;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

interface Message {
	info: { role: string; [key: string]: unknown };
	parts: MessagePart[];
}

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
	const todoPreserver = new TodoPreserver();
	const preemptUsage = new Map<string, CachedUsage>();
	const preemptInProgress = new Set<string>();
	const preemptLast = new Map<string, number>();
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

	// Trigger proactive compaction when the reported usage nears the limit.
	const maybePreempt = async (sessionID: string): Promise<void> => {
		const cfg = config.preemptiveCompaction;
		if (!cfg?.enabled) return;
		const usage = preemptUsage.get(sessionID);
		if (!usage) return;
		if (preemptInProgress.has(sessionID)) return;

		const limit = await resolveContextLimit(usage.providerID, usage.modelID);
		if (limit === undefined) return;

		const trigger = shouldTriggerPreemptiveCompaction({
			totalInputTokens: totalInputTokens(usage.tokens),
			contextLimit: limit,
			threshold: cfg.threshold,
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
				ratio: totalInputTokens(usage.tokens) / limit,
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

			// Track file operations
			const tracker = getTracker(sessionID);
			tracker.processToolCall(tool, args as Record<string, unknown>);

			// Capture compress tool calls
			if (tool === "compress") {
				const a = args as Record<string, unknown>;
				if (
					typeof a.topic === "string" &&
					typeof a.start === "number" &&
					typeof a.end === "number" &&
					typeof a.summary === "string"
				) {
					compressions.queue(sessionID, {
						topic: a.topic,
						start: a.start,
						end: a.end,
						summary: a.summary,
						timestamp: Date.now(),
						callID: input.callID,
					});
					logger.info("compress queued", {
						sessionID,
						topic: a.topic,
						range: `${a.start}-${a.end}`,
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
						previousSummary = extractPreviousSummary(list);
					} catch (error) {
						logger.info("previous summary fetch failed", {
							error: String(error),
						});
					}
				}
			}

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

			// 0. Apply pending compressions (from compress tool calls).
			// The transform hook receives no session id, so each request is scoped
			// by the callID of its compress tool call: a compression queued for one
			// session is never applied to another. Non-matching requests stay queued
			// until they expire.
			for (const sid of sessionTrackers.keys()) {
				const requests = compressions.drain(sid);
				if (requests.length === 0) continue;

				const { applicable, deferred } = selectCompressions(
					messages as Parameters<typeof selectCompressions>[0],
					requests,
				);

				if (applicable.length > 0) {
					const replaced = applyCompressions(
						messages as Parameters<typeof applyCompressions>[0],
						applicable,
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
					messages as Parameters<typeof applyDedup>[0],
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
				const purged = applyPurgeErrors(
					messages as Parameters<typeof applyPurgeErrors>[0],
					config,
					purgeProtected,
				);
				if (purged > 0) {
					logger.info("error purge applied", { count: purged });
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
					todoPreserver.clear(sessionID);
					preemptUsage.delete(sessionID);
					preemptInProgress.delete(sessionID);
					preemptLast.delete(sessionID);
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
			todoPreserver.clearAll();
			preemptUsage.clear();
			preemptInProgress.clear();
			preemptLast.clear();
			contextLimitCache.clear();
			degradation.clearAll();
			for (const timer of autocontinueGuard.values()) clearTimeout(timer);
			autocontinueGuard.clear();
		},

		// -----------------------------------------------------------------------
		// Config: ensure the compress tool is permitted
		// -----------------------------------------------------------------------
		config: async (opencodeConfig: Record<string, unknown>) => {
			// Ensure the compress tool is permitted, without clobbering a global
			// permission string (e.g. "permission": "allow") or an explicit deny.
			const permission = opencodeConfig.permission;
			if (typeof permission !== "string") {
				const map = (permission as Record<string, unknown> | undefined) ?? {};
				if (map.compress !== "deny") {
					opencodeConfig.permission = { ...map, compress: "allow" };
				}
			}
			// The built-in `/compact` command is intentionally left untouched.
		},

		// -----------------------------------------------------------------------
		// Compress tool definition
		// -----------------------------------------------------------------------
		// The `tool` hook maps a tool name to its definition.
		tool: { compress: buildCompressToolDef() },
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
