/**
 * Plugin-facing types, inlined from `@opencode-ai/plugin` so the runtime does
 * not require it beyond the `tool` helper. They match the Hooks/Plugin shape.
 */

import type { Message } from "./types.js";

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
