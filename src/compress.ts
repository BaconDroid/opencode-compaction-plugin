/**
 * Compress tool for opencode-live-compaction.
 *
 * Exposes a "compress" tool to the model that replaces a range of messages
 * with a summary written by the model itself. The model has full context,
 * so it can write high-quality summaries. The plugin handles the mechanical
 * replacement in the messages array.
 *
 * Flow:
 *   1. Model calls compress({ topic, start, end, summary })
 *   2. Tool stores the pending compression request
 *   3. On next message transform, the range is replaced with a synthetic
 *      summary message
 */

import { tool } from "@opencode-ai/plugin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressRequest {
	/** Topic label for the compression (3-5 words) */
	topic: string;
	/** Start message index (inclusive, 0-based) */
	start: number;
	/** End message index (inclusive, 0-based) */
	end: number;
	/** Summary text written by the model */
	summary: string;
	/** Timestamp for ordering */
	timestamp: number;
	/** callID of the compress tool call that produced this request */
	callID?: string;
}

// ---------------------------------------------------------------------------
// Pending compressions storage (per instance, per session)
// ---------------------------------------------------------------------------

/**
 * Per-plugin-instance store of pending compression requests. Kept as a class so
 * state is not shared between plugin instances in the same process.
 */
export class CompressionStore {
	private queues = new Map<string, CompressRequest[]>();

	/** Queue a compression request for a session. */
	queue(sessionID: string, request: CompressRequest): void {
		let queue = this.queues.get(sessionID);
		if (!queue) {
			queue = [];
			this.queues.set(sessionID, queue);
		}
		queue.push(request);
	}

	/** Get and clear pending compressions for a session (newest range first). */
	drain(sessionID: string): CompressRequest[] {
		const queue = this.queues.get(sessionID) ?? [];
		this.queues.delete(sessionID);
		return queue.sort((a, b) => b.start - a.start); // Process from end to start
	}

	/** Clear all pending compressions for a session. */
	clear(sessionID: string): void {
		this.queues.delete(sessionID);
	}

	/** Clear every pending compression (for dispose). */
	clearAll(): void {
		this.queues.clear();
	}
}

// ---------------------------------------------------------------------------
// Compression application
// ---------------------------------------------------------------------------

interface Message {
	info: { role: string; id?: string; [key: string]: unknown };
	parts: Array<{
		type: string;
		text?: string;
		tool?: string;
		callID?: string;
		[key: string]: unknown;
	}>;
}

/**
 * Split compression requests into those that belong to the given message array
 * and those that must be deferred.
 *
 * A request is applicable when its originating `callID` appears in the messages
 * (i.e. the compress tool call is part of this conversation). Requests without a
 * `callID` are treated as applicable for backward compatibility. This prevents a
 * compression queued for one session from being applied to another session's
 * messages by index.
 */
export function selectCompressions(
	messages: Message[],
	requests: CompressRequest[],
): { applicable: CompressRequest[]; deferred: CompressRequest[] } {
	const present = new Set<string>();
	for (const msg of messages) {
		for (const part of msg.parts ?? []) {
			if (typeof part.callID === "string") present.add(part.callID);
		}
	}

	const applicable: CompressRequest[] = [];
	const deferred: CompressRequest[] = [];

	for (const req of requests) {
		if (!req.callID || present.has(req.callID)) {
			applicable.push(req);
		} else {
			deferred.push(req);
		}
	}

	return { applicable, deferred };
}

/**
 * Apply pending compressions to a messages array.
 * Processes from end to start to keep indices stable.
 *
 * Returns the number of messages replaced.
 */
export function applyCompressions(
	messages: Message[],
	requests: CompressRequest[],
): number {
	if (requests.length === 0) return 0;

	let totalReplaced = 0;

	for (const req of requests) {
		const start = Math.max(0, req.start);
		const end = Math.min(messages.length - 1, req.end);

		if (start > end || start >= messages.length) continue;

		// Count how many messages we're replacing
		const count = end - start + 1;

		// Choose a role that does not collide with the preceding message, so the
		// synthetic block does not create two consecutive same-role messages.
		const prevRole = messages[start - 1]?.info?.role;
		const role = prevRole === "user" ? "assistant" : "user";

		// Create a synthetic summary message
		const summaryMessage: Message = {
			info: { role },
			parts: [
				{
					type: "text",
					text: `<compressed-block topic="${escapeAttr(req.topic)}" range="${start}-${end}" count="${count}">\n${req.summary}\n</compressed-block>`,
				},
			],
		};

		// Replace the range with the summary
		messages.splice(start, count, summaryMessage);
		totalReplaced += count;
	}

	return totalReplaced;
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Tool definition (for OpenCode plugin API)
// ---------------------------------------------------------------------------

/**
 * Build the compress tool definition via the plugin SDK helper, so OpenCode
 * receives a valid `ToolDefinition` (Zod args + execute).
 */
export function buildCompressToolDef() {
	return tool({
		description: `Compress a range of conversation messages into a summary.

Use this tool when you have completed a task phase and want to reduce context size.
You write the summary — you have the full context. Be thorough but concise.

The compressed range will be replaced with your summary in the conversation.
Message indices are 0-based. Use the message order visible in the conversation.`,
		args: {
			topic: tool.schema
				.string()
				.describe("Short label (3-5 words) for display, e.g., 'Auth Bug Fix'"),
			start: tool.schema
				.number()
				.describe("Start message index (inclusive, 0-based)"),
			end: tool.schema
				.number()
				.describe("End message index (inclusive, 0-based)"),
			summary: tool.schema
				.string()
				.describe(
					"Complete technical summary replacing all messages in the range. Include file paths, decisions, error strings, and code snippets that are still relevant.",
				),
		},
		async execute(args) {
			return `Compression queued for messages ${args.start}-${args.end} (${args.topic}). It will be applied on the next message transform.`;
		},
	});
}
