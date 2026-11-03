/**
 * Shared message shapes and plugin-facing types.
 *
 * OpenCode's message objects are loosely typed at the plugin boundary; a single
 * permissive shape keeps the modules interoperable without per-module copies.
 * The plugin-context types are inlined (the runtime contract they mirror is
 * `@opencode/plugin` 2.0.30) so the plugin has no runtime dependencies.
 */

/** Minimal logger writing to OpenCode's app log. */
export interface Logger {
	/** Debug-level diagnostic (gated by the `debug` config flag). */
	info: (message: string, data?: unknown) => void;
	/** Always-on diagnostic (adapter misconfig, swallowed hook errors). */
	warn: (message: string, data?: unknown) => void;
}

export interface MessagePart {
	type: string;
	text?: string;
	tool?: string;
	callID?: string;
	args?: unknown;
	state?: {
		status?: string;
		output?: string;
		input?: unknown;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface Message {
	info: {
		role: string;
		id?: string;
		timestamp?: number;
		time?: { created?: number };
		[key: string]: unknown;
	};
	parts: MessagePart[];
}

export interface PluginInput {
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
			messages?: (input: { path: { id: string } }) => Promise<unknown>;
			create?: (input: {
				body?: { parentID?: string; title?: string };
				query?: { directory?: string };
			}) => Promise<{ data?: { id?: string } }>;
			prompt?: (input: {
				path: { id: string };
				query?: { directory?: string };
				body: {
					model?: { providerID: string; modelID: string };
					system?: string;
					tools?: Record<string, boolean>;
					parts: Array<{ type: string; text?: string }>;
				};
			}) => Promise<{ data?: { parts?: Array<{ type?: string; text?: string }> } }>;
			delete?: (input: {
				path: { id: string };
				query?: { directory?: string };
			}) => Promise<unknown>;
		};
	};
	project: { id: string; name: string };
	directory: string;
	worktree: string;
	serverUrl: URL;
}

/**
 * OpenCode 2 plugin definition. The runtime validates the default export as an
 * object carrying `id` plus `setup` (or an Effect `effect`); `@opencode/plugin`'s
 * `Plugin.define` is the typed identity helper for exactly this shape.
 */
export interface Plugin {
	readonly id: string;
	readonly setup: (context: PluginContext) => PluginCleanup | Promise<PluginCleanup>;
}

export type PluginCleanup = void | (() => void | Promise<void>);

/** Session hook names this plugin registers. */
export interface SessionHooks {
	/** Runs immediately before an agent-loop model request. */
	context: {
		sessionID: string;
		agent: string;
		model: { providerID: string; id: string };
		system: Array<{ type: "text"; text: string }>;
		messages: unknown[];
		options: Record<string, unknown>;
		tools: Record<string, unknown>;
	};
	/** Runs before a checkpoint summary; the host appends its own prompt afterwards. */
	compaction: {
		sessionID: string;
		agent: string;
		model: { providerID: string; id: string };
		system: Array<{ type: "text"; text: string }>;
		messages: unknown[];
		options: Record<string, unknown>;
		tools: Record<string, unknown>;
	};
}

/** Tool hook events this plugin registers. */
export interface ToolHooks {
	"execute.after": {
		tool: string;
		sessionID: string;
		agent: string;
		messageID: string;
		/** The tool call id (V1's `callID`). */
		id: string;
		/** The tool arguments (V1's `args`). */
		input: unknown;
	} & (
		| { status: "completed"; result: unknown }
		| { status: "error"; error: unknown }
	);
}

export interface Registration {
	dispose: () => Promise<void>;
}

/**
 * The plugin context the 2.0 host passes to `setup`. Only the domains this
 * plugin touches are modelled; the rest of the surface is unused.
 */
export interface PluginContext {
	readonly app: { readonly name: string; readonly version: string; readonly channel: string };
	readonly location: {
		readonly directory: string;
		readonly project: { readonly id: string; readonly directory: string; readonly canonical: string };
	};
	readonly options: Readonly<Record<string, unknown>>;
	readonly session: {
		hook<Name extends keyof SessionHooks>(
			name: Name,
			callback: (event: SessionHooks[Name]) => Promise<void> | void,
		): Promise<Registration>;
		context(input: { sessionID: string }): Promise<readonly unknown[]>;
	};
	readonly tool: {
		hook<Name extends keyof ToolHooks>(
			name: Name,
			callback: (event: ToolHooks[Name]) => Promise<void> | void,
		): Promise<Registration>;
		transform(callback: (editor: ToolEditor) => void): Promise<Registration>;
	};
	readonly event: {
		subscribe(options?: { signal?: AbortSignal; types?: readonly string[] }): AsyncIterable<{
			type: string;
			data?: Record<string, unknown>;
		}>;
	};
	readonly generate: {
		text(input: {
			prompt: string;
			model?: { id: string; providerID: string; variant?: string } | null;
		}): Promise<{ text: string }>;
	};
	readonly storage: {
		get(key: string): Promise<unknown>;
		set(key: string, value: unknown): Promise<void>;
		remove(key: string): Promise<void>;
	};
}

export interface ToolEditor {
	add(tool: {
		name: string;
		description: string;
		input: Record<string, unknown>;
		execute: (input: unknown, context: unknown) => Promise<{ content: string }>;
	}): void;
	update(id: string, update: (tool: Record<string, unknown>) => void): void;
	remove(id: string): void;
	list(): readonly unknown[];
	get(id: string): unknown;
	namespace(namespace: { name: string; description: string }): void;
}
