/**
 * Shared message shapes for the compaction pipeline.
 *
 * OpenCode's message objects are loosely typed at the plugin boundary; a single
 * permissive shape keeps the modules interoperable without per-module copies.
 */

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
