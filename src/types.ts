/**
 * Shared message shapes and plugin-facing types.
 *
 * OpenCode's message objects are loosely typed at the plugin boundary; a single
 * permissive shape keeps the modules interoperable without per-module copies.
 * The plugin types are inlined from `@opencode-ai/plugin` so the runtime does
 * not require it beyond the `tool` helper.
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
			todo?: (input: { path: { id: string } }) => Promise<unknown>;
			messages?: (input: { path: { id: string } }) => Promise<unknown>;
			summarize?: (input: {
				path: { id: string };
				body: { providerID: string; modelID: string; auto?: boolean };
				query: { directory: string };
			}) => Promise<unknown>;
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
		provider?: {
			list?: (input?: Record<string, unknown>) => Promise<unknown>;
		};
	};
	project: { id: string; name: string };
	directory: string;
	worktree: string;
	serverUrl: URL;
}

export type Plugin = (
	input: PluginInput,
	options?: Record<string, unknown>,
) => Promise<Hooks>;

export interface Hooks {
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
