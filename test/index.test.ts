import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { CompactionPlugin } from "../src/index.ts";
import {
	callHook,
	compactionEvent,
	contextEvent,
	setupPlugin,
	type Harness,
} from "./harness.ts";
import { makeTmpSetup } from "./helpers.ts";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = join(import.meta.dirname, "__tmp_index_test");
const { setup: setupTmp, cleanup: cleanupTmp } = makeTmpSetup(TMP_DIR);

describe("CompactionPlugin", () => {
	const userTurns = (n: number) =>
		Array.from({ length: n }, (_, i) => [
			{ info: { role: "user" }, parts: [{ type: "text", text: `r${i + 1}` }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
		]).flat();

	async function getHooks(
		options?: unknown,
		overrides: Record<string, any> = {},
	): Promise<Harness> {
		return setupPlugin(TMP_DIR, options, overrides);
	}

	const emit = (harness: Harness, type: string, properties: unknown) =>
		harness.emit({
			type,
			data: properties && typeof properties === "object" ? properties : {},
		});

	// The 2.0 compaction hook injects the prompt delta as a system part; the
	// host appends its own summary prompt afterwards.
	const compact = async (
		harness: Harness,
		sessionID: string,
		output?: { context: string[]; prompt?: string },
	) => {
		const event = compactionEvent(sessionID);
		await callHook(harness, "compaction", event);
		const texts = event.system
			.filter((part) => part.type === "text")
			.map((part) => part.text);
		if (output) {
			output.context = texts;
			output.prompt = texts[0];
		}
		return { event, texts, text: texts.join("\n") };
	};

	const transform = async (harness: Harness, messages: unknown) => {
		await callHook(harness, "context", contextEvent("sess", messages));
	};

	const afterTool = async (
		harness: Harness,
		tool: string,
		sessionID: string,
		callID: string,
		args: unknown,
	) => {
		// 2.0 tool events use `id` for V1's callID and `input` for V1's args.
		await callHook(harness, "execute.after", {
			tool,
			sessionID,
			agent: "build",
			messageID: "msg",
			id: callID,
			input: args,
			status: "completed",
			result: {},
		});
	};

	beforeEach(() => {
		setupTmp();
		mock.clearAllMocks();
	});

	afterEach(cleanupTmp);

	// ---------------------------------------------------------------------------
	// Plugin initialization
	// ---------------------------------------------------------------------------

	describe("initialization", () => {
		it("registers the documented hooks, tool and cleanup", async () => {
			const harness = await getHooks();
			expect(harness.hooks["execute.after"]).toHaveLength(1);
			expect(harness.hooks["compaction"]).toHaveLength(1);
			expect(harness.hooks["context"]).toHaveLength(1);
			expect(harness.tools.map((tool) => tool.name)).toEqual(["compress"]);
			expect(harness.cleanup).toBeTypeOf("function");
		});

		it("logs initialization when debug is enabled", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "compaction.json"),
				JSON.stringify({ debug: true }),
			);
			const lines: string[] = [];
			const original = process.stderr.write.bind(process.stderr);
			(process.stderr as any).write = (chunk: unknown) => {
				lines.push(String(chunk));
				return true;
			};
			try {
				await getHooks();
			} finally {
				(process.stderr as any).write = original;
			}
			expect(lines.length).toBeGreaterThan(0);
			expect(lines[0]).toContain("[opencode-compaction-plugin]");
			expect(lines[0]).toContain("initialized");
		});

		it("registers nothing when disabled via config", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "compaction.json"),
				JSON.stringify({ enabled: false }),
			);
			const harness = await getHooks();
			expect(harness.hooks["execute.after"]).toBeUndefined();
			expect(harness.tools).toHaveLength(0);
		});
	});

	// ---------------------------------------------------------------------------
	// tool.execute.after
	// ---------------------------------------------------------------------------

	describe("tool.execute.after", () => {
		it("records read/write/edit operations in the compaction prompt", async () => {
			const hooks = await getHooks({ promptMode: "replace" });
			const cases: Array<[string, string, string, string]> = [
				["read", "sess-1", "call-1", "src/a.ts"],
				["write", "sess-2", "call-2", "lib/b.ts"],
				["edit", "sess-3", "call-3", "cfg.ts"],
			];
			for (const [tool, sessionID, callID, filePath] of cases) {
				await afterTool(hooks, tool, sessionID, callID, { filePath });
				const output = { context: [], prompt: undefined };
				await compact(hooks, sessionID, output);
				expect(output.prompt, tool).toContain(filePath);
			}

			// Several files in one session are all listed.
			await afterTool(hooks, "read", "sess-multi", "c1", { filePath: "a.ts" });
			await afterTool(hooks, "write", "sess-multi", "c2", { filePath: "b.ts" });
			const multi = { context: [], prompt: undefined };
			await compact(hooks, "sess-multi", multi);
			expect(multi.prompt).toContain("a.ts");
			expect(multi.prompt).toContain("b.ts");
		});

		it("ignores calls without sessionID or args", async () => {
			const hooks = await getHooks({ promptMode: "replace" });
			await afterTool(hooks, "read", "", "call-4", { filePath: "x.ts" });
			await afterTool(hooks, "read", "sess-5", "call-5", null as any);

			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-5", output);
			expect(output.prompt).not.toContain("## Files Touched Manifest");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.session.compacting
	// ---------------------------------------------------------------------------

	describe("experimental.session.compacting", () => {
		it("replaces output.prompt with enhanced prompt", async () => {
			const hooks = await getHooks({ promptMode: "replace" });
			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-compact", output);
			expect(output.prompt).toBeDefined();
			expect(output.prompt).toContain("## Brief");
			expect(output.prompt).toContain("## Task Continuity");
			expect(output.prompt).toContain("## Mandatory Reading");
		});

		it("includes files manifest when files were tracked", async () => {
			const hooks = await getHooks({ promptMode: "replace" });
			await afterTool(hooks, "read", "sess-files", "c1", { filePath: "readme.md" });

			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-files", output);
			expect(output.prompt).toContain("## Files Touched");
			expect(output.prompt).toContain("readme.md");
		});

		it("clears tracker after compaction", async () => {
			const hooks = await getHooks({ promptMode: "replace" });
			await afterTool(hooks, "read", "sess-clear", "c1", { filePath: "x.ts" });

			// First compaction should include the file
			const output1 = { context: [], prompt: undefined };
			await compact(hooks, "sess-clear", output1);
			expect(output1.prompt).toContain("x.ts");

			// Second compaction should NOT include the file (tracker was cleared)
			const output2 = { context: [], prompt: undefined };
			await compact(hooks, "sess-clear", output2);
			expect(output2.prompt).not.toContain("x.ts");
		});

		it("works without any tracked files", async () => {
			const hooks = await getHooks({ promptMode: "replace" });
			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-empty", output);
			expect(output.prompt).toBeDefined();
			expect(output.prompt).not.toContain("## Files Touched Manifest");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.compaction.autocontinue
	// ---------------------------------------------------------------------------

	describe("auto-continue", () => {
		it("has no 2.0 registration: the session runner auto-continues natively", async () => {
			const harness = await getHooks();
			// V1 gated a synthetic "continue" turn. OpenCode 2 continues the step
			// loop itself after auto-compaction and refuses to compact again while
			// the last message is a completed compaction, so the duplicate-trigger
			// loop the V1 guard suppressed cannot form.
			expect(harness.hooks["autocontinue"]).toBeUndefined();
			expect(
				harness.hooks["experimental.compaction.autocontinue"],
			).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// hook error isolation
	// ---------------------------------------------------------------------------

	describe("hook error isolation", () => {
		it("does not reject when a hook throws", async () => {
			const harness = await getHooks();
			await expect(transform(harness, null)).resolves.toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// event handler
	// ---------------------------------------------------------------------------

	describe("event", () => {
		it("cleans up trackers on session.deleted", async () => {
			const harness = await getHooks({ promptMode: "replace" });
			await afterTool(harness, "read", "sess-del", "c1", { filePath: "y.ts" });
			// OpenCode 2 carries the session id under `data.sessionID`.
			await emit(harness, "session.deleted", { sessionID: "sess-del" });
			const output = { context: [], prompt: undefined };
			await compact(harness, "sess-del", output);
			expect(output.prompt).not.toContain("y.ts");
		});
	});

	// ---------------------------------------------------------------------------
	// dispose
	// ---------------------------------------------------------------------------

	describe("dispose", () => {
		it("clears all session trackers", async () => {
			const hooks = await getHooks({ promptMode: "replace" });

			await afterTool(hooks, "read", "sess-a", "c1", { filePath: "a.ts" });
			await afterTool(hooks, "write", "sess-b", "c2", { filePath: "b.ts" });

			await hooks.cleanup!();

			// Both sessions should be cleared
			const outputA = { context: [], prompt: undefined };
			await compact(hooks, "sess-a", outputA);
			expect(outputA.prompt).not.toContain("a.ts");

			const outputB = { context: [], prompt: undefined };
			await compact(hooks, "sess-b", outputB);
			expect(outputB.prompt).not.toContain("b.ts");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.chat.messages.transform (dedup + purge + eviction)
	// ---------------------------------------------------------------------------

	describe("experimental.chat.messages.transform", () => {
		it("preserves short tool outputs", async () => {
			const hooks = await getHooks();
			const shortOutput = "File edited successfully";
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "edit",
							state: { output: shortOutput },
						},
					],
				},
			];
			await transform(hooks, messages);
			expect(messages[0].parts[0].state.output).toBe(shortOutput);
		});

		it("handles malformed messages without throwing or modifying them", async () => {
			const hooks = await getHooks();
			const messages = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool", state: { output: "something" } }] },
			];
			await transform(hooks, messages);
			expect(messages[0].parts[0].text).toBe("hello");
			expect(messages[2].parts[0].state.output).toBe("something");
		});

		it("deduplicates identical tool calls", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "a.ts" },
							state: { output: "old content" },
						},
					],
				},
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "a.ts" },
							state: { output: "new content" },
						},
					],
				},
			];
			await transform(hooks, messages);
			// First should be deduped
			expect(messages[0].parts[0].state.output).toContain("deduped");
			// Second should be preserved
			expect(messages[1].parts[0].state.output).toBe("new content");
		});

		it("deduplicates the 2.0 wire message shape (split tool-call / tool-result)", async () => {
			const harness = await getHooks();
			// OpenCode 2 sends a tool call as a `tool-call` part in the assistant
			// message and its output as a `tool-result` part in the next message.
			const wire: any[] = [
				{
					id: "m1",
					role: "assistant",
					content: [
						{ type: "text", text: "a" },
						{ type: "tool-call", id: "c1", name: "read", input: { filePath: "a.ts" } },
					],
				},
				{
					role: "tool",
					content: [
						{ type: "tool-result", id: "c1", name: "read", result: { type: "text", value: "old content" } },
					],
				},
				{
					id: "m2",
					role: "assistant",
					content: [
						{ type: "tool-call", id: "c2", name: "read", input: { filePath: "a.ts" } },
					],
				},
				{
					role: "tool",
					content: [
						{ type: "tool-result", id: "c2", name: "read", result: { type: "text", value: "new content" } },
					],
				},
			];
			await transform(harness, wire);
			const outputs = wire
				.filter((message) => message.role === "tool")
				.map((message) => message.content[0].result.value);
			expect(outputs[0]).toContain("deduped");
			expect(outputs[1]).toBe("new content");
		});

		it("purges an errored 2.0 tool call and writes the marker back", async () => {
			const harness = await getHooks({ purgeErrors: { wholeAttempt: true } });
			const wire: any[] = [
				{
					id: "m1",
					role: "assistant",
					content: [
						{
							type: "tool-call",
							id: "c1",
							name: "bash",
							input: { command: "run", data: "x".repeat(500) },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							id: "c1",
							name: "bash",
							result: { type: "error", value: "command failed" },
						},
					],
				},
				...Array.from({ length: 5 }, (_, i) => ({
					id: `u${i}`,
					role: "user",
					content: [{ type: "text", text: `turn ${i}` }],
				})),
			];
			await transform(harness, wire);
			expect(wire[0].content[0].input.purged).toContain("removed");
			expect(wire[1].content[0].result.value).toContain("[purged failed bash:");
		});

		it("tolerates a message without parts and still runs later stages", async () => {
			const hooks = await getHooks();
			const tool = (output: string) => ({
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "read",
						args: { filePath: "a.ts" },
						state: { output },
					},
				],
			});
			// Index 0 has no `parts`; a stage must tolerate it and still run the
			// rest (dedup/purge/eviction) for the whole batch.
			const messages = [
				{ info: { role: "assistant" } },
				tool("v1"),
				tool("v2"),
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect(messages[1].parts[0].state.output).toContain("deduped");
		});

		it("purges large inputs from errored tools outside the recent window", async () => {
			const hooks = await getHooks({ purgeErrors: { wholeAttempt: false } });
			const bigInput = "x".repeat(500);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "bash",
							state: {
								status: "error",
								output: "command failed",
								input: bigInput,
							},
						},
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect((messages[0].parts[0].state.input as any).purged).toContain(
				"removed",
			);
			expect(messages[0].parts[0].state.output).toBe("command failed");
		});

		it("purges the whole failed attempt when wholeAttempt is enabled", async () => {
			const hooks = await getHooks({ purgeErrors: { wholeAttempt: true } });
			const bigInput = "x".repeat(500);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "bash",
							state: {
								status: "error",
								output: "command failed badly",
								input: bigInput,
							},
						},
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect((messages[0].parts[0].state.input as any).purged).toContain(
				"removed",
			);
			expect(messages[0].parts[0].state.output).toContain("[purged failed bash:");
			expect(messages[0].parts[0].state.output).toContain("command failed");
		});

		it("cascades the purge to dependent tool calls when enabled", async () => {
			const hooks = await getHooks({ purgeErrors: { cascade: true } });
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "bash",
							callID: "callA",
							state: {
								status: "error",
								output: "boom",
								input: { command: "run A", data: "x".repeat(200) },
							},
						},
					],
				},
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "bash",
							callID: "callB",
							state: {
								status: "success",
								output: "ok",
								input: { command: "use callA result" },
							},
						},
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			// callA is errored and purged; callB depends on it and is cascaded.
			expect((messages[0].parts[0].state.input as any).purged).toContain(
				"removed",
			);
			expect((messages[1].parts[0].state.input as any).purged).toContain(
				"cascade",
			);
		});

		it("preserves recent errored tool inputs", async () => {
			const hooks = await getHooks();
			const bigInput = "x".repeat(500);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "bash",
							state: {
								status: "error",
								output: "command failed",
								input: bigInput,
							},
						},
					],
				},
			];
			await transform(hooks, messages);
			expect(messages[0].parts[0].state.input).toBe(bigInput);
		});
	});

	// ---------------------------------------------------------------------------
	// config (permission handling)
	// ---------------------------------------------------------------------------

	describe("permission config", () => {
		it("honors plugin options", async () => {
			const harness = await getHooks({ enabled: false });
			expect(harness.hooks["execute.after"]).toBeUndefined();
		});

		it("leaves permission policy to the host (no global config mutation in 2.0)", async () => {
			const harness = await getHooks();
			// V1 filled an unset `permission[tool] = "allow"` through the global
			// config hook. OpenCode 2 exposes no plugin-mutable global config; its
			// default agent permission set already allows every tool apart from
			// `*.env` reads, so the shim is unnecessary rather than dropped.
			expect(harness.hooks.config).toBeUndefined();
			expect(harness.tools.map((tool) => tool.name)).toEqual(["compress"]);
		});
	});

	// ---------------------------------------------------------------------------
	// Compress tool integration
	// ---------------------------------------------------------------------------

	describe("compress tool", () => {
		it("queues compression on compress tool call", async () => {
			const hooks = await getHooks();

			// Simulate a compress tool call
			await afterTool(hooks, "compress", "sess-compress", "c-comp", {
						topic: "Auth Bug Fix",
						start: 0,
						end: 3,
						summary: "Fixed the auth bug by updating login.ts",
					});

			// Verify by checking that messages transform applies the compression
			const messages = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "fix auth" }] },
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "investigating" }],
				},
				{ info: { role: "user" }, parts: [{ type: "text", text: "try this" }] },
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "done" }],
				},
				{
					info: { role: "user" },
					parts: [
						{ type: "text", text: "next task" },
						{
							type: "tool",
							tool: "compress",
							callID: "c-comp",
							state: { output: "compressed" },
						},
					],
				},
			];

			await transform(hooks, messages);

			// Messages 0-3 should have been compressed into one
			expect(messages).toHaveLength(2); // 5 - 4 + 1 = 2
			expect(messages[0].parts[0].text).toContain("Auth Bug Fix");
			expect(messages[0].parts[0].text).toContain("compressed-block");
			expect(messages[1].parts[0].text).toBe("next task");
		});

		it("does not apply a compression to a different session's messages", async () => {
			const hooks = await getHooks();

			await afterTool(hooks, "compress", "sess-A", "c-A", { topic: "A", start: 0, end: 1, summary: "sumA" });

			// Transform a conversation that does NOT contain c-A: untouched.
			const other = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "y" }] },
			];
			await transform(hooks, other);
			expect(other).toHaveLength(2);
			expect((other[0].parts[0] as any).text).toBe("x");

			// Transform the owning conversation: compression applies.
			const own = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "y" }] },
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "compress",
							callID: "c-A",
							state: { output: "ok" },
						},
					],
				},
			];
			await transform(hooks, own);
			expect(own).toHaveLength(2); // 3 - 2 + 1 = 2
			expect((own[0].parts[0] as any).text).toContain("sumA");
		});

		it("applies a queued compression", async () => {
			const hooks = await getHooks();

			await afterTool(hooks, "compress", "sess-low", "c-low", { topic: "T", start: 0, end: 1, summary: "S" });

			const msgs = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "y" }] },
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "compress",
							callID: "c-low",
							state: { output: "ok" },
						},
					],
				},
			];
			await transform(hooks, msgs);
			expect(msgs).toHaveLength(2);
			expect((msgs[0].parts[0] as any).text).toContain("S");
		});

		it("drops stale deferred compressions", async () => {
			const hooks = await getHooks();
			await afterTool(hooks, "compress", "sess-stale", "c-stale", { topic: "Old", start: 0, end: 1, summary: "old" });

			// Jump past the 30-minute TTL for deferred requests.
			const realNow = Date.now;
			Date.now = () => realNow() + 31 * 60 * 1000;
			try {
				// First transform (no c-stale) defers then expires the request.
				await transform(hooks, [
					{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
				]);

				// The owning conversation must not see the expired request.
				const own = [
					{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
					{
						info: { role: "assistant" },
						parts: [
							{
								type: "tool",
								tool: "compress",
								callID: "c-stale",
								state: { output: "ok" },
							},
						],
					},
				];
				await transform(hooks, own);
				expect(own).toHaveLength(2);
				expect((own[0].parts[0] as any).text).toBe("x");
			} finally {
				Date.now = realNow;
			}
		});
	});

	describe("compaction prompt mode", () => {
		it("augments the default prompt with the delta (no full template)", async () => {
			const hooks = await getHooks();
			const output = {
				context: [] as string[],
				prompt: undefined as string | undefined,
			};
			await compact(hooks, "sess-aug", output);
			// One system part: the delta only, the host keeps its default prompt.
			expect(output.context).toHaveLength(1);
			const text = output.context.join("\n");
			expect(text).toContain("## Task Continuity");
			expect(text).not.toContain("<template>");
		});
	});

	describe("previous summary continuity", () => {
		// OpenCode 2 returns projected session messages from `session.context()`;
		// a completed compaction surfaces as `{ type: "compaction", summary }`.
		const sessionContext = (list: unknown[]) => ({
			session: { context: async () => list },
		});

		it("carries the previous summary into the replace prompt", async () => {
			const hooks = await getHooks(
				{ promptMode: "replace" },
				sessionContext([
					{
						type: "compaction",
						status: "completed",
						id: "s0",
						summary: "PRIOR SUMMARY",
						time: { created: 1 },
					},
				]),
			);

			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-prev", output);
			expect(output.prompt).toContain("<previous-summary>");
			expect(output.prompt).toContain("PRIOR SUMMARY");
		});

		it("keeps continuity across repeated compactions without duplication", async () => {
			const list: unknown[] = [
				{
					type: "compaction",
					status: "completed",
					id: "s1",
					summary: "FIRST SUMMARY",
					time: { created: 1 },
				},
			];
			const hooks = await getHooks({ promptMode: "replace" }, sessionContext(list));

			const out1 = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-slide", out1);
			expect(out1.prompt).toContain("FIRST SUMMARY");

			// Same summary still present: continuity is preserved, emitted once.
			const out2 = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-slide", out2);
			expect(out2.prompt).toContain("FIRST SUMMARY");
			expect(out2.prompt!.split("FIRST SUMMARY")).toHaveLength(2);

			// A newer summary supersedes the carried one.
			list.push({
				type: "compaction",
				status: "completed",
				id: "s2",
				summary: "SECOND SUMMARY",
				time: { created: 2 },
			});
			const out3 = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-slide", out3);
			expect(out3.prompt).toContain("SECOND SUMMARY");
		});

		it("injects the latest user ask into the replace prompt", async () => {
			const hooks = await getHooks(
				{ promptMode: "replace" },
				sessionContext([
					{
						type: "assistant",
						id: "a1",
						content: [{ type: "text", text: "ok" }],
						time: { created: 1 },
					},
					{ type: "user", id: "u1", text: "please fix the login bug", time: { created: 2 } },
				]),
			);

			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-ask", output);
			expect(output.prompt).toContain("<latest-user-ask>");
			expect(output.prompt).toContain("please fix the login bug");
		});

		it("adds the delta without the previous summary in augment mode", async () => {
			const hooks = await getHooks(
				{ promptMode: "augment" },
				sessionContext([
					{ type: "compaction", status: "completed", id: "s0", summary: "PRIOR SUMMARY", time: { created: 1 } },
					{ type: "user", id: "u1", text: "do the thing", time: { created: 2 } },
				]),
			);
			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-aug2", output);
			// A single injected system part: the delta only.
			expect(output.context).toHaveLength(1);
			const text = output.context.join("\n");
			// The default prompt already carries the previous summary.
			expect(text).not.toContain("<previous-summary>");
			expect(text).toContain("<latest-user-ask>");
			expect(text).toContain("## Task Continuity");
		});
	});

	describe("adapter diagnostics", () => {
		// OpenCode 2 plugin diagnostics are written to the server stderr stream.
		const makeHooks = async (debug: boolean) => {
			const lines: string[] = [];
			const original = process.stderr.write.bind(process.stderr);
			(process.stderr as any).write = (chunk: unknown) => {
				lines.push(String(chunk));
				return true;
			};
			try {
				await getHooks({ debug, adapters: { scorer: { provider: "mcp" } } });
			} finally {
				(process.stderr as any).write = original;
			}
			return lines;
		};

		it("warns about a misconfigured adapter even when debug is off", async () => {
			const logs = await makeHooks(false);
			expect(logs.some((line) => line.includes("mcp provider is not supported"))).toBe(true);
			// Info stays gated by debug.
			expect(logs.some((line) => line.includes("initialized"))).toBe(false);
		});

		it("emits info logs when debug is on", async () => {
			const logs = await makeHooks(true);
			expect(logs.some((line) => line.includes("initialized"))).toBe(true);
		});
	});

});
