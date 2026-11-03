/**
 * OpenCode V2 message boundary.
 *
 * The 2.0 host hands plugins two message shapes that differ from the one the
 * domain modules were written against (`{ info, parts }`):
 *
 * - session hooks (`context`, `compaction`) receive *wire* messages:
 *   `{ id?, role, content: ContentPart[] }` where a tool call is split into a
 *   `tool-call` part (in the assistant message) and a `tool-result` part (in the
 *   following `role: "tool"` message);
 * - `session.context()` returns *projected* session messages:
 *   `{ type: "user" | "assistant" | "compaction" | ... }`.
 *
 * These helpers project both into the internal shape, keep a back-reference to
 * the host objects, and write the pipeline's mutations back. Domain modules are
 * untouched.
 */

import type { Message, MessagePart } from "../types.js";

/** A content part of a wire message. Loosely typed on purpose: the host owns the schema. */
export interface WirePart {
	type: string;
	text?: string | null;
	id?: string;
	name?: string;
	input?: unknown;
	result?: { type?: string; value?: unknown };
	[key: string]: unknown;
}

/** A wire message as the `context` / `compaction` hooks receive it. */
export interface WireMessage {
	id?: string;
	role: string;
	content?: WirePart[];
	[key: string]: unknown;
}

/** Internal part with the host references used for write-back. */
interface ToolPart extends MessagePart {
	__call?: WirePart;
	__result?: WirePart;
}

/** Render a tool result as the flat text the pipeline reasons about. */
function resultText(result: WirePart["result"]): string | undefined {
	if (!result) return undefined;
	const value = result.value;
	if (result.type === "content") {
		if (!Array.isArray(value)) return undefined;
		const texts = value
			.filter(
				(part): part is { type: "text"; text: string } =>
					!!part && part.type === "text" && typeof part.text === "string",
			)
			.map((part) => part.text);
		return texts.length > 0 ? texts.join("\n") : undefined;
	}
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return undefined;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/** Rebuild a tool result, preserving its original discriminant where possible. */
function toResult(
	originalType: string | undefined,
	value: string | undefined,
): { type: string; value: unknown } {
	const text = value ?? "";
	switch (originalType) {
		case "content":
			return { type: "content", value: [{ type: "text", text }] };
		case "json":
			return { type: "json", value: text };
		case "error":
			return { type: "error", value: text };
		default:
			return { type: "text", value: text };
	}
}

/** Copy the pipeline's mutations on a tool part back into the host parts. */
function syncPart(part: MessagePart): void {
	const state = part.type === "tool" ? (part as ToolPart).state : undefined;
	const tool = part as ToolPart;
	if (part.type !== "tool" || (!tool.__call && !tool.__result)) return;

	if (tool.__call) {
		const input = part.args !== undefined ? part.args : state?.input;
		if (input !== tool.__call.input) tool.__call.input = input;
	}

	if (tool.__result && state) {
		const output = typeof state.output === "string" ? state.output : undefined;
		if (output !== resultText(tool.__result.result)) {
			tool.__result.result = toResult(tool.__result.result?.type, output);
		}
	}
}

/** Expand an internal part back into the wire parts it came from. */
function toWireParts(part: MessagePart): WirePart[] {
	const tool = part as ToolPart;
	syncPart(part);
	if (tool.__call) {
		const parts: WirePart[] = [tool.__call];
		if (tool.__result) parts.push(tool.__result);
		return parts;
	}
	if (tool.__result) return [tool.__result];
	// text / reasoning / media / compaction / effort are shared by reference.
	return [part as unknown as WirePart];
}

/** The text a synthetic (pipeline-created) message carries. */
function messageText(message: Message): string {
	return (message.parts ?? [])
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

export interface MessageProjection {
	/** Messages in the internal `{ info, parts }` shape the pipeline expects. */
	messages: Message[];
	/** Reconcile the (possibly mutated) messages back into the host array. */
	commit: () => void;
}

/**
 * Project the messages a session hook received into the internal shape.
 *
 * Already-internal input (used by unit tests and by callers that normalized the
 * array themselves) is passed through untouched, so mutations land directly.
 */
export function projectMessages(input: unknown): MessageProjection {
	if (!Array.isArray(input)) {
		return { messages: [], commit: () => {} };
	}
	// Wire messages always carry a `content` array; internal ones never do.
	const looksWire = input.some(
		(m) => !!m && typeof m === "object" && Array.isArray((m as WireMessage).content),
	);
	if (!looksWire) {
		return { messages: input as Message[], commit: () => {} };
	}

	const wire = input as WireMessage[];

	// Tool calls and results are paired by id across the whole request; the host
	// splits them into separate messages but the pipeline needs one part.
	const calls = new Map<string, WirePart>();
	const results = new Map<string, WirePart>();
	for (const message of wire) {
		for (const part of message.content ?? []) {
			if (!part || typeof part !== "object") continue;
			if (part.type === "tool-call" && typeof part.id === "string") calls.set(part.id, part);
			else if (part.type === "tool-result" && typeof part.id === "string")
				results.set(part.id, part);
		}
	}

	const view: Message[] = [];
	const sources = new Map<Message, { wire: WireMessage; parts: MessagePart[] }>();

	for (const message of wire) {
		const parts: MessagePart[] = [];
		const calledHere = new Set<string>();

		for (const part of message.content ?? []) {
			if (!part || typeof part !== "object") continue;

			if (part.type === "tool-call") {
				const id = typeof part.id === "string" ? part.id : undefined;
				const result = id ? results.get(id) : undefined;
				if (id) calledHere.add(id);
				const merged: ToolPart = {
					type: "tool",
					tool: typeof part.name === "string" ? part.name : id,
					callID: id,
					args: part.input,
					state: {
						status: result
							? result.result?.type === "error"
								? "error"
								: "completed"
							: "running",
						output: resultText(result?.result),
						input: part.input,
					},
					__call: part,
					__result: result,
				};
				parts.push(merged);
				continue;
			}

			if (part.type === "tool-result") {
				const id = typeof part.id === "string" ? part.id : undefined;
				// The call already carries the merged state in this message.
				if (id && calledHere.has(id)) continue;
				// The call lives elsewhere and owns the state; keep a passthrough so
				// the host message survives a rebuild and the output is not double
				// counted by the eviction budget.
				if (id && calls.has(id)) {
					parts.push({ type: "tool-result", callID: id, __result: part });
					continue;
				}
				// Orphan result: expose it as a tool part so dedup/purge can see it.
				parts.push({
					type: "tool",
					tool: typeof part.name === "string" ? part.name : id,
					callID: id,
					state: {
						status: part.result?.type === "error" ? "error" : "completed",
						output: resultText(part.result),
					},
					__result: part,
				});
				continue;
			}

			// text / reasoning / media / compaction / effort: shared by reference so
			// in-place `part.text` mutations reach the host message.
			parts.push(part as unknown as MessagePart);
		}

		const internal: Message = { info: { role: message.role, id: message.id }, parts };
		view.push(internal);
		sources.set(internal, { wire: message, parts });
	}

	const commit = (): void => {
		const next: WireMessage[] = [];
		for (const message of view) {
			const source = sources.get(message);
			if (!source) {
				// Created by the pipeline (compression summary).
				next.push({
					role: message.info?.role === "user" ? "user" : "assistant",
					content: [{ type: "text", text: messageText(message) }],
				});
				continue;
			}
			for (const part of message.parts ?? []) syncPart(part);
			if (message.parts !== source.parts) {
				// The pipeline replaced the parts array (episode eviction): rebuild.
				source.wire.content = message.parts.flatMap(toWireParts);
			}
			next.push(source.wire);
		}
		wire.length = 0;
		for (const message of next) wire.push(message);
	};

	return { messages: view, commit };
}

/** Projected session message as returned by `session.context()`. */
export interface SessionMessageLike {
	type: string;
	id?: string;
	time?: { created?: number };
	text?: string;
	summary?: string;
	status?: string;
	content?: Array<Record<string, unknown>>;
	[key: string]: unknown;
}

/**
 * Project `session.context()` output into the internal shape.
 *
 * A completed compaction is surfaced as an assistant message with
 * `info.summary === true`, which is how the previous-summary helpers recognise
 * a carried-forward checkpoint.
 */
export function projectSessionMessages(input: unknown): Message[] {
	if (!Array.isArray(input)) return [];
	const messages: Message[] = [];

	for (const raw of input) {
		const message = raw as SessionMessageLike;
		if (!message || typeof message !== "object") continue;

		switch (message.type) {
			case "user":
			case "synthetic":
			case "shell":
			case "system":
				messages.push({
					info: { role: "user", id: message.id, time: message.time },
					parts: [
						{ type: "text", text: typeof message.text === "string" ? message.text : "" },
					],
				});
				break;

			case "assistant": {
				const parts: MessagePart[] = [];
				for (const part of message.content ?? []) {
					if (!part || typeof part !== "object") continue;
					if (part.type === "text" || part.type === "reasoning") {
						parts.push({
							type: part.type,
							text: typeof part.text === "string" ? part.text : "",
						});
					} else if (part.type === "tool") {
						parts.push({
							type: "tool",
							tool: typeof part.name === "string" ? part.name : undefined,
							callID: typeof part.id === "string" ? part.id : undefined,
							args: (part.state as { input?: unknown } | undefined)?.input,
							state: part.state as MessagePart["state"],
						});
					}
				}
				messages.push({
					info: { role: "assistant", id: message.id, time: message.time },
					parts,
				});
				break;
			}

			case "compaction": {
				if (
					message.status !== "completed" ||
					typeof message.summary !== "string" ||
					message.summary === ""
				) {
					break;
				}
				messages.push({
					info: { role: "assistant", id: message.id, time: message.time, summary: true },
					parts: [{ type: "text", text: message.summary }],
				});
				break;
			}

			default:
				break;
		}
	}

	return messages;
}
