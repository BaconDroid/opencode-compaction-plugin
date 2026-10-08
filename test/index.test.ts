import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { LiveCompactionPlugin } from "../src/index.ts";
import { makeTmpSetup } from "./helpers.ts";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = join(import.meta.dirname, "__tmp_index_test");
const { setup: setupTmp, cleanup: cleanupTmp } = makeTmpSetup(TMP_DIR);

// Access the internal session trackers map for testing
// We test through the public plugin interface only

describe("LiveCompactionPlugin", () => {
	const logMock = () => mock().mockResolvedValue(undefined);
	const userTurns = (n: number) =>
		Array.from({ length: n }, (_, i) => [
			{ info: { role: "user" }, parts: [{ type: "text", text: `r${i + 1}` }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
		]).flat();

	const mockCtx = {
		client: { app: { log: logMock() } },
		project: { id: "test-project", name: "test" },
		directory: TMP_DIR,
		worktree: TMP_DIR,
		serverUrl: new URL("http://localhost:4096"),
	};

	async function getHooks() {
		return await LiveCompactionPlugin(mockCtx as any);
	}

	const emit = (hooks: any, type: string, properties: unknown) =>
		hooks.event!({ event: { id: "e", type, properties } });

	const compact = (hooks: any, sessionID: string, output: any) =>
		hooks["experimental.session.compacting"]!({ sessionID }, output);

	const transform = (hooks: any, messages: unknown) =>
		hooks["experimental.chat.messages.transform"]!({} as any, { messages });

	const afterTool = (
		hooks: any,
		tool: string,
		sessionID: string,
		callID: string,
		args: unknown,
	) =>
		hooks["tool.execute.after"](
			{ tool, sessionID, callID, args },
			{ title: "", output: "", metadata: {} },
		);

	beforeEach(() => {
		setupTmp();
		mock.clearAllMocks();
	});

	afterEach(cleanupTmp);

	// ---------------------------------------------------------------------------
	// Plugin initialization
	// ---------------------------------------------------------------------------

	describe("initialization", () => {
		it("returns an object with expected hooks", async () => {
			const hooks = await getHooks();
			expect(hooks["tool.execute.after"]).toBeTypeOf("function");
			expect(hooks["experimental.session.compacting"]).toBeTypeOf("function");
			expect(hooks["experimental.compaction.autocontinue"]).toBeTypeOf(
				"function",
			);
			expect(hooks.event).toBeTypeOf("function");
			expect(hooks.dispose).toBeTypeOf("function");
			expect(hooks["experimental.chat.messages.transform"]).toBeTypeOf(
				"function",
			);
		});

		it("logs initialization when debug is enabled", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ debug: true }),
			);
			const logSpy = mock().mockResolvedValue(undefined);
			await LiveCompactionPlugin({
				...mockCtx,
				client: { app: { log: logSpy } },
				directory: TMP_DIR,
			} as any);
			expect(logSpy).toHaveBeenCalled();
			expect(logSpy.mock.calls[0][0].body.service).toBe("live-compaction");
			expect(logSpy.mock.calls[0][0].body.message).toContain("initialized");
		});

		it("returns no hooks when disabled via config", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ enabled: false }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);
			expect(hooks["tool.execute.after"]).toBeUndefined();
			expect((hooks as any).tool).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// tool.execute.after
	// ---------------------------------------------------------------------------

	describe("tool.execute.after", () => {
		it("records read/write/edit operations in the compaction prompt", async () => {
			const hooks = await getHooks();
			const cases: Array<[string, string, string, string]> = [
				["read", "sess-1", "call-1", "src/a.ts"],
				["write", "sess-2", "call-2", "lib/b.ts"],
				["edit", "sess-3", "call-3", "cfg.ts"],
			];
			for (const [tool, sessionID, callID, filePath] of cases) {
				await hooks["tool.execute.after"]!(
					{ tool, sessionID, callID, args: { filePath } },
					{ title: "", output: "", metadata: {} },
				);
				const output = { context: [], prompt: undefined };
				await compact(hooks, sessionID, output);
				expect(output.prompt, tool).toContain(filePath);
			}
		});

		it("ignores calls without sessionID or args", async () => {
			const hooks = await getHooks();
			await afterTool(hooks, "read", "", "call-4", { filePath: "x.ts" });
			await afterTool(hooks, "read", "sess-5", "call-5", null as any);

			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-5", output);
			expect(output.prompt).not.toContain("## Files Touched Manifest");
		});

		it("tracks multiple files in same session", async () => {
			const hooks = await getHooks();
			await afterTool(hooks, "read", "sess-multi", "c1", { filePath: "a.ts" });
			await afterTool(hooks, "write", "sess-multi", "c2", { filePath: "b.ts" });

			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-multi", output);
			expect(output.prompt).toContain("a.ts");
			expect(output.prompt).toContain("b.ts");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.session.compacting
	// ---------------------------------------------------------------------------

	describe("experimental.session.compacting", () => {
		it("replaces output.prompt with enhanced prompt", async () => {
			const hooks = await getHooks();
			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-compact", output);
			expect(output.prompt).toBeDefined();
			expect(output.prompt).toContain("## Brief");
			expect(output.prompt).toContain("## Task Continuity");
			expect(output.prompt).toContain("## Mandatory Reading");
		});

		it("includes files manifest when files were tracked", async () => {
			const hooks = await getHooks();
			await afterTool(hooks, "read", "sess-files", "c1", { filePath: "readme.md" });

			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-files", output);
			expect(output.prompt).toContain("## Files Touched");
			expect(output.prompt).toContain("readme.md");
		});

		it("clears tracker after compaction", async () => {
			const hooks = await getHooks();
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
			const hooks = await getHooks();
			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-empty", output);
			expect(output.prompt).toBeDefined();
			expect(output.prompt).not.toContain("## Files Touched Manifest");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.compaction.autocontinue
	// ---------------------------------------------------------------------------

	describe("experimental.compaction.autocontinue", () => {
		it("sets enabled to true", async () => {
			const hooks = await getHooks();
			const output = { enabled: false };
			await hooks["experimental.compaction.autocontinue"]!({} as any, output);
			expect(output.enabled).toBe(true);
		});

		it("disables autocontinue for the compaction agent", async () => {
			const hooks = await getHooks();
			const output = { enabled: true };
			await hooks["experimental.compaction.autocontinue"]!(
				{ sessionID: "s", agent: "compaction" } as any,
				output,
			);
			expect(output.enabled).toBe(false);
		});

		it("suppresses duplicate autocontinue for a session", async () => {
			const hooks = await getHooks();
			const first = { enabled: false };
			await hooks["experimental.compaction.autocontinue"]!(
				{ sessionID: "sess-dup", agent: "build" } as any,
				first,
			);
			expect(first.enabled).toBe(true);

			const second = { enabled: false };
			await hooks["experimental.compaction.autocontinue"]!(
				{ sessionID: "sess-dup", agent: "build" } as any,
				second,
			);
			expect(second.enabled).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// hook error isolation
	// ---------------------------------------------------------------------------

	describe("hook error isolation", () => {
		it("does not reject when a hook throws", async () => {
			const hooks = await getHooks();
			await expect(
				hooks["experimental.chat.messages.transform"]!({} as any, {
					messages: null,
				} as any),
			).resolves.toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// event handler
	// ---------------------------------------------------------------------------

	describe("event", () => {
		it("cleans up trackers on session.deleted for both payload shapes", async () => {
			const hooks = await getHooks();
			const cases: Array<[string, string, Record<string, unknown>]> = [
				["sess-del", "y.ts", { sessionID: "sess-del" }],
				["sess-del2", "z.ts", { info: { id: "sess-del2" } }],
			];
			for (const [sessionID, filePath, properties] of cases) {
				await hooks["tool.execute.after"]!(
					{ tool: "read", sessionID, callID: "c1", args: { filePath } },
					{ title: "", output: "", metadata: {} },
				);
				await hooks.event!({
					event: { id: "evt", type: "session.deleted", properties },
				});
				const output = { context: [], prompt: undefined };
				await compact(hooks, sessionID, output);
				expect(output.prompt, sessionID).not.toContain(filePath);
			}
		});

		it("ignores other event types without logging", async () => {
			const logs: string[] = [];
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: {
					app: {
						log: (input: { body: { message: string } }) => {
							logs.push(input.body.message);
							return Promise.resolve();
						},
					},
				},
				directory: TMP_DIR,
			} as any);
			await hooks.event!({
				event: { id: "evt-2", type: "session.updated", properties: {} },
			});
			expect(logs).toEqual([]);
		});
	});

	// ---------------------------------------------------------------------------
	// dispose
	// ---------------------------------------------------------------------------

	describe("dispose", () => {
		it("clears all session trackers", async () => {
			const hooks = await getHooks();

			await afterTool(hooks, "read", "sess-a", "c1", { filePath: "a.ts" });
			await afterTool(hooks, "write", "sess-b", "c2", { filePath: "b.ts" });

			await hooks.dispose!();

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
	// experimental.chat.messages.transform (trim + dedup + purge)
	// ---------------------------------------------------------------------------

	describe("experimental.chat.messages.transform", () => {
		it("trims long bash tool outputs", async () => {
			const hooks = await getHooks();
			const longOutput = "x".repeat(5000);
			// Build messages with the tool call outside the protected turn window (4 turns)
			// Tool at index 0, followed by 5 user turns to push it out of the window
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "bash", state: { output: longOutput } },
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect((messages[0].parts[0] as any).state.output.length).toBeLessThan(
				1000,
			);
			expect((messages[0].parts[0] as any).state.output).toContain("[trimmed");
		});

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

		it("trims read outputs to 300 chars", async () => {
			const hooks = await getHooks();
			const fileContent = "line\n".repeat(200); // ~1200 chars
			// Tool at index 0, followed by 5 user turns to push it out of window
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: fileContent } },
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect((messages[0].parts[0] as any).state.output.length).toBeLessThan(
				400,
			);
		});

		it("does not re-trim an already trimmed output", async () => {
			const hooks = await getHooks();
			const longOutput = "x".repeat(5000);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "bash", state: { output: longOutput } },
					],
				},
				...userTurns(5),
			];

			await transform(hooks, messages);
			const firstPass = (messages[0].parts[0] as any).state.output;
			expect(firstPass).toContain("[trimmed");

			// Second pass must be a no-op on the already trimmed output.
			await transform(hooks, messages);
			expect((messages[0].parts[0] as any).state.output).toBe(firstPass);
		});

		it("handles malformed messages without throwing or modifying them", async () => {
			const hooks = await getHooks();
			const messages = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool", state: { output: "something" } }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, { messages });
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

		it("purges large inputs from errored tools outside the recent window", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				purgeErrors: { wholeAttempt: false },
			} as any);
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
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				purgeErrors: { wholeAttempt: true },
			} as any);
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
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				purgeErrors: { cascade: true },
			} as any);
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

	describe("config", () => {
		it("does not register or override any command", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.command).toBeUndefined();
		});

		it("honors plugin options", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				enabled: false,
			} as any);
			expect((hooks as any)["tool.execute.after"]).toBeUndefined();
		});

		it("does not corrupt a global permission string", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = { permission: "allow" };
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.permission).toBe("allow");
		});

		it("adds the plugin tool permissions to an object permission", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {
				permission: { bash: "ask" },
			};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.permission).toEqual({
				bash: "ask",
				compress: "allow",
				squash: "allow",
				expand: "allow",
				recall: "allow",
				inspect: "allow",
				search: "allow",
			});
		});

		it("respects an explicit compress deny while allowing the others", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {
				permission: { compress: "deny" },
			};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.permission).toEqual({
				compress: "deny",
				squash: "allow",
				expand: "allow",
				recall: "allow",
				inspect: "allow",
				search: "allow",
			});
		});

		it("respects an explicit deny for any plugin tool", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {
				permission: { squash: "deny" },
			};
			await (hooks as any).config(opencodeConfig);
			expect((opencodeConfig.permission as any).squash).toBe("deny");
			expect((opencodeConfig.permission as any).compress).toBe("allow");
		});

		it("does not escalate an explicit per-tool ask", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {
				permission: { compress: "ask" },
			};
			await (hooks as any).config(opencodeConfig);
			expect((opencodeConfig.permission as any).compress).toBe("ask");
			expect((opencodeConfig.permission as any).squash).toBe("allow");
		});
	});

	// ---------------------------------------------------------------------------
	// Protected file patterns
	// ---------------------------------------------------------------------------

	describe("protected file patterns", () => {
		it("does not trim outputs from protected files", async () => {
			// Create a config with protected patterns
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ protectedFilePatterns: ["AGENTS.md"] }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);

			const longContent = "x".repeat(2000);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "AGENTS.md" },
							state: { output: longContent },
						},
					],
				},
				// Push the tool out of the turn-protection window so trimming
				// actually runs (otherwise the test is vacuous).
				...userTurns(5),
			];
			await transform(hooks, messages);
			// Should NOT be trimmed because AGENTS.md is protected
			expect(messages[0].parts[0].state.output).toBe(longContent);
		});

		it("trims outputs from non-protected files", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ protectedFilePatterns: ["AGENTS.md"] }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);

			const longContent = "x".repeat(2000);
			// Tool at index 0, followed by 5 user turns to push it out of window
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "src/other.ts" },
							state: { output: longContent },
						},
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			// SHOULD be trimmed (not in protected patterns + outside turn window)
			expect((messages[0].parts[0] as any).state.output.length).toBeLessThan(
				500,
			);
		});

		it("supports glob patterns for protected files", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ protectedFilePatterns: ["**/*.config.ts"] }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);

			const longContent = "x".repeat(2000);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "src/build.config.ts" },
							state: { output: longContent },
						},
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect(messages[0].parts[0].state.output).toBe(longContent);
		});

		it("detects protected files passed via state.input", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ protectedFilePatterns: ["AGENTS.md"] }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);

			const longContent = "x".repeat(2000);
			// Tool at index 0, pushed out of the turn window by 5 user turns.
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							state: {
								output: longContent,
								input: JSON.stringify({ filePath: "AGENTS.md" }),
							},
						},
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect(messages[0].parts[0].state.output).toBe(longContent);
		});
	});

	// ---------------------------------------------------------------------------
	// Turn protection
	// ---------------------------------------------------------------------------

	describe("turn protection", () => {
		it("does not trim tool outputs in recent turns", async () => {
			const hooks = await getHooks();

			// Simulate a conversation: user -> assistant (tool) -> user -> assistant (tool)
			const longContent = "x".repeat(2000);
			const messages = [
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "read the file" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							state: { output: longContent },
						},
					],
				},
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "now edit it" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "edit",
							state: { output: longContent },
						},
					],
				},
			];
			await transform(hooks, messages);

			// Both tool outputs should be protected (within last 4 turns)
			expect((messages[1].parts[0] as any).state.output).toBe(longContent);
			expect((messages[3].parts[0] as any).state.output).toBe(longContent);
		});

		it("trims tool outputs outside the protected turn window", async () => {
			const hooks = await getHooks();

			// Create a longer conversation that exceeds the turn window
			const longContent = "x".repeat(2000);
			const messages = [
				// Old turn (should be trimmed)
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "old request" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
				// Turn 2
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 2" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "bash", state: { output: longContent } },
					],
				},
				// Turn 3
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 3" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
				// Turn 4
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 4" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
				// Turn 5 (recent, protected)
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 5" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
			];
			await transform(hooks, messages);

			// Old tool output (index 1) should be trimmed
			expect((messages[1].parts[0] as any).state.output.length).toBeLessThan(
				500,
			);
			// Recent tool outputs should be protected
			expect((messages[9].parts[0] as any).state.output).toBe(longContent);
		});
	});

	// ---------------------------------------------------------------------------
	// Compress tool integration
	// ---------------------------------------------------------------------------

	describe("compress tool", () => {
		it("exposes a valid compress tool definition", async () => {
			const hooks = await getHooks();
			const def = (hooks as any).tool.compress;
			expect(def).toBeDefined();
			expect(def.description).toContain("Compress");
			expect(def.args).toHaveProperty("topic");
			expect(def.args).toHaveProperty("start");
			expect(def.args).toHaveProperty("end");
			expect(def.args).toHaveProperty("summary");
			expect(typeof def.execute).toBe("function");
		});

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

		it("exposes a squash tool and merges contiguous blocks", async () => {
			const hooks = await getHooks();
			expect((hooks as any).tool.squash).toBeDefined();

			await afterTool(hooks, "squash", "sess-squash", "c-sq", { from: "b0", to: "b1", topic: "Merged", summary: "combined" });

			const block = (id: string, label: string, body: string) => ({
				info: { role: "assistant" },
				parts: [
					{
						type: "text",
						text: `<compressed-block id="${id}" label="${label}">${body}</compressed-block>`,
					},
				],
			});
			// The squash tool call must be part of the conversation for the
			// request to be scoped to it.
			const first = block("a", "b0", "[b0]\n\nfirst");
			first.parts.push({
				type: "tool",
				tool: "squash",
				callID: "c-sq",
				state: { output: "ok" },
			} as never);
			const messages = [first, block("b", "b1", "[b1]\n\nsecond")];
			await transform(hooks, messages);
			expect(messages).toHaveLength(1);
			expect(messages[0].parts[0].text).toContain("combined");
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

		it("does not apply a squash to a different session's messages", async () => {
			const hooks = await getHooks();
			await afterTool(hooks, "squash", "sess-S", "c-S", {
				from: "b0",
				to: "b1",
				topic: "M",
				summary: "sumS",
			});
			const block = (id: string, label: string, body: string) => ({
				info: { role: "assistant" },
				parts: [
					{
						type: "text",
						text: `<compressed-block id="${id}" label="${label}">${body}</compressed-block>`,
					},
				],
			});

			// Other conversation (no c-S): untouched.
			const other = [
				block("a", "b0", "[b0]\n\nfirst"),
				block("b", "b1", "[b1]\n\nsecond"),
			];
			await transform(hooks, other);
			expect(other).toHaveLength(2);

			// Owning conversation (contains c-S): merged.
			const own = [
				block("a", "b0", "[b0]\n\nfirst"),
				block("b", "b1", "[b1]\n\nsecond"),
			];
			own[0].parts.push({
				type: "tool",
				tool: "squash",
				callID: "c-S",
				state: { output: "ok" },
			} as never);
			await transform(hooks, own);
			expect(own).toHaveLength(1);
			expect(own[0].parts[0].text).toContain("sumS");
		});

		it("does not apply an expand to a different session's messages", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				compress: { reversible: true },
			} as any);
			// Empty callID keeps the compression applicable (backward compat).
			await afterTool(hooks, "compress", "sess-E", "", {
				topic: "T",
				start: 0,
				end: 1,
				summary: "S",
			});
			const own = [
				{
					info: { role: "user", timestamp: 1 },
					parts: [{ type: "text", text: "orig1" }],
				},
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "orig2" }] },
				{
					info: { role: "user" },
					parts: [
						{ type: "text", text: "keep" },
						{
							type: "tool",
							tool: "expand",
							callID: "c-exp",
							state: { output: "ok" },
						},
					],
				},
			];
			await transform(hooks, own); // sidecar records id "u:1"
			expect(own).toHaveLength(2);

			await afterTool(hooks, "expand", "sess-E", "c-exp", { block: "b0" });

			// Other conversation with a colliding block id but no c-exp.
			const other = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "text",
							text: '<compressed-block id="u:1" label="b0">[b0]\n\nother</compressed-block>',
						},
					],
				},
			];
			await transform(hooks, other);
			expect(other).toHaveLength(1);

			// Owning conversation: expanded.
			await transform(hooks, own);
			expect(own).toHaveLength(3);
		});

		it("defers a compression requested far below the compaction threshold", async () => {
			const list = mock().mockResolvedValue({
				data: {
					all: [
						{ id: "prov", models: { "model-x": { limit: { context: 1000 } } } },
					],
				},
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: logMock() },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await emit(hooks, "message.updated", { info: { sessionID: "sess-low", role: "assistant", providerID: "prov", modelID: "model-x", finish: "stop", tokens: { input: 100 }, }, });

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
			// Not eligible: the compression is not applied.
			expect(msgs).toHaveLength(3);
		});

		it("allows a compression near the compaction threshold", async () => {
			const list = mock().mockResolvedValue({
				data: {
					all: [
						{ id: "prov", models: { "model-x": { limit: { context: 1000 } } } },
					],
				},
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: logMock() },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await emit(hooks, "message.updated", { info: { sessionID: "sess-high", role: "assistant", providerID: "prov", modelID: "model-x", finish: "stop", tokens: { input: 900 }, }, });

			await afterTool(hooks, "compress", "sess-high", "c-high", { topic: "T", start: 0, end: 1, summary: "S" });

			const msgs = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "y" }] },
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "compress",
							callID: "c-high",
							state: { output: "ok" },
						},
					],
				},
			];
			await transform(hooks, msgs);
			expect(msgs).toHaveLength(2);
			expect((msgs[0].parts[0] as any).text).toContain("S");
		});

		it("restores original messages via expand", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				compress: { reversible: true },
			} as any);

			await afterTool(hooks, "compress", "sess-expand", "", { topic: "T", start: 0, end: 1, summary: "S" });

			const messages = [
				{
					info: { role: "user", timestamp: 1 },
					parts: [{ type: "text", text: "orig1" }],
				},
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "orig2" }] },
				{
					info: { role: "user" },
					parts: [
						{ type: "text", text: "keep" },
						{
							type: "tool",
							tool: "expand",
							callID: "c-expand",
							state: { output: "ok" },
						},
					],
				},
			];
			await transform(hooks, messages);
			expect(messages).toHaveLength(2);
			expect(messages[0].parts[0].text).toContain("[b0]");

			await afterTool(hooks, "expand", "sess-expand", "c-expand", { block: "b0" });
			await transform(hooks, messages);
			expect(messages).toHaveLength(3);
			expect(messages[0].parts[0].text).toBe("orig1");
			expect(messages[1].parts[0].text).toBe("orig2");
		});

		it("expands a squashed reversible block to all originals", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				compress: { reversible: true },
			} as any);
			const messages = [
				{
					info: { role: "user", timestamp: 1 },
					parts: [{ type: "text", text: "u0" }],
				},
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "a1" }] },
				{
					info: { role: "user", timestamp: 2 },
					parts: [{ type: "text", text: "u2" }],
				},
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "a3" }] },
				{
					info: { role: "user" },
					parts: [
						{ type: "text", text: "keep" },
						{
							type: "tool",
							tool: "squash",
							callID: "c-sq",
							state: { output: "ok" },
						},
						{
							type: "tool",
							tool: "expand",
							callID: "c-exp",
							state: { output: "ok" },
						},
					],
				},
			];

			await afterTool(hooks, "compress", "s", "", {
				topic: "A",
				start: 0,
				end: 1,
				summary: "first",
			});
			await transform(hooks, messages);
			await afterTool(hooks, "compress", "s", "", {
				topic: "B",
				start: 1,
				end: 2,
				summary: "second",
			});
			await transform(hooks, messages);
			expect(messages).toHaveLength(3); // blockA, blockB, keep

			await afterTool(hooks, "squash", "s", "c-sq", {
				from: "b0",
				to: "b1",
				topic: "M",
				summary: "merged",
			});
			await transform(hooks, messages);
			expect(messages).toHaveLength(2); // merged, keep

			await afterTool(hooks, "expand", "s", "c-exp", { block: "b0" });
			await transform(hooks, messages);
			expect(messages).toHaveLength(5);
			expect(messages.map((m) => (m.parts[0] as any).text)).toEqual([
				"u0",
				"a1",
				"u2",
				"a3",
				"keep",
			]);
		});

		it("drops stale deferred compressions", async () => {
			const hooks = await getHooks();
			await afterTool(hooks, "compress", "sess-stale", "c-stale", { topic: "Old", start: 0, end: 1, summary: "old" });

			// Jump past the 30-minute TTL for deferred requests.
			const realNow = Date.now;
			Date.now = () => realNow() + 31 * 60 * 1000;
			try {
				// First transform (no c-stale) defers then expires the request.
				await hooks["experimental.chat.messages.transform"]!({} as any, {
					messages: [
						{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
					],
				});

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

	describe("todo preservation", () => {
		it("captures todos on compaction and handles session.compacted", async () => {
			const logSpy = mock().mockResolvedValue(undefined);
			const todo = mock().mockResolvedValue({
				data: [{ content: "x", status: "pending" }],
			});
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: { app: { log: logSpy }, session: { todo } },
				directory: TMP_DIR,
			} as any);

			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-todo", output);
			expect(todo).toHaveBeenCalledWith({ path: { id: "sess-todo" } });
			expect(output.prompt).toBeDefined();

			await expect(
				hooks.event!({
					event: {
						id: "e",
						type: "session.compacted",
						properties: { sessionID: "sess-todo" },
					},
				}),
			).resolves.toBeUndefined();
		});

		it("renders the captured todos as task-state in the prompt", async () => {
			const todo = mock().mockResolvedValue({
				data: [
					{
						id: "t1",
						content: "write tests",
						status: "in_progress",
						priority: "high",
					},
				],
			});
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: { app: { log: logMock() }, session: { todo } },
				directory: TMP_DIR,
			} as any);

			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-task", output);
			expect(output.prompt).toContain("<task-state>");
			expect(output.prompt).toContain("- [~] write tests");
			expect(output.prompt).toContain("status=in_progress");
		});

		it("does not throw when the todo API is unavailable", async () => {
			const hooks = await getHooks();
			const output = { context: [], prompt: undefined };
			await compact(hooks, "sess-no-todo", output);
			expect(output.prompt).toBeDefined();
		});
	});

	describe("preemptive compaction", () => {
		it("triggers summarize near the context limit", async () => {
			const summarize = mock().mockResolvedValue(undefined);
			const list = mock().mockResolvedValue({
				data: {
					all: [
						{ id: "prov", models: { "model-x": { limit: { context: 1000 } } } },
					],
				},
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: logMock() },
						session: { summarize },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await emit(hooks, "message.updated", { info: { id: "m1", sessionID: "sess-preempt", role: "assistant", providerID: "prov", modelID: "model-x", finish: "stop", tokens: { input: 900, cache: { read: 0, write: 0 } }, }, });

			await afterTool(hooks, "read", "sess-preempt", "c1", { filePath: "a.ts" });

			expect(summarize).toHaveBeenCalledWith({
				path: { id: "sess-preempt" },
				body: { providerID: "prov", modelID: "model-x", auto: true },
				query: { directory: TMP_DIR },
			});
		});

		it("triggers on turn end without a tool call", async () => {
			const summarize = mock().mockResolvedValue(undefined);
			const list = mock().mockResolvedValue({
				data: {
					all: [
						{ id: "prov", models: { "model-x": { limit: { context: 1000 } } } },
					],
				},
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: logMock() },
						session: { summarize },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await emit(hooks, "message.updated", { info: { sessionID: "sess-turn", role: "assistant", providerID: "prov", modelID: "model-x", finish: "stop", tokens: { input: 900 }, }, });

			expect(summarize).toHaveBeenCalledWith({
				path: { id: "sess-turn" },
				body: { providerID: "prov", modelID: "model-x", auto: true },
				query: { directory: TMP_DIR },
			});
		});

		it("honors the tail guard until enough new tool calls", async () => {
			const summarize = mock().mockResolvedValue(undefined);
			const list = mock().mockResolvedValue({
				data: {
					all: [
						{ id: "prov", models: { "model-x": { limit: { context: 1000 } } } },
					],
				},
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: logMock() },
						session: { summarize },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{
					preemptiveCompaction: {
						enabled: true,
						tailGuard: { enabled: true, minNewToolCalls: 3 },
					},
				} as any,
			);

			await emit(hooks, "message.updated", { info: { sessionID: "sess-tail", role: "assistant", providerID: "prov", modelID: "model-x", finish: "stop", tokens: { input: 900 }, }, });
			expect(summarize).not.toHaveBeenCalled();

			for (let i = 0; i < 3; i++) {
				await afterTool(hooks, "read", "sess-tail", `c${i}`, { filePath: "a.ts" });
			}

			expect(summarize).toHaveBeenCalledTimes(1);
		});

		it("does not trigger when disabled", async () => {
			const summarize = mock().mockResolvedValue(undefined);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: {
					app: { log: logMock() },
					session: { summarize },
					provider: { list: mock() },
				},
				directory: TMP_DIR,
			} as any);

			await emit(hooks, "message.updated", { info: { sessionID: "sess-off", role: "assistant", providerID: "prov", modelID: "model-x", finish: "stop", tokens: { input: 999_999 }, }, });
			await afterTool(hooks, "read", "sess-off", "c", { filePath: "a.ts" });
			expect(summarize).not.toHaveBeenCalled();
		});
	});

	describe("compaction prompt mode", () => {
		it("augments the default prompt when promptMode is augment", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				promptMode: "augment",
			} as any);
			const output = {
				context: [] as string[],
				prompt: undefined as string | undefined,
			};
			await compact(hooks, "sess-aug", output);
			expect(output.prompt).toBeUndefined();
			expect(output.context.join("\n")).toContain("<template>");
		});
	});

	describe("degradation monitor", () => {
		it("warns when assistant messages lose text after compaction", async () => {
			const log = mock().mockResolvedValue(undefined);
			const messages = mock().mockResolvedValue({
				data: [
					{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
					{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
					{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
				],
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: { app: { log }, session: { messages } },
					directory: TMP_DIR,
				} as any,
				{
					debug: true,
					degradationMonitor: { enabled: true, threshold: 3 },
				} as any,
			);

			await emit(hooks, "session.compacted", { sessionID: "sess-deg" });
			await emit(hooks, "message.updated", { info: { sessionID: "sess-deg", role: "assistant", finish: "stop", }, });

			const logged = log.mock.calls
				.map((call) => JSON.stringify(call[0]))
				.join("\n");
			expect(logged).toContain("post-compaction degradation detected");
		});
	});

	describe("previous summary continuity", () => {
		it("carries the previous summary into the replace prompt", async () => {
			const messages = mock().mockResolvedValue({
				data: [
					{
						info: { role: "assistant", summary: true },
						parts: [{ type: "text", text: "PRIOR SUMMARY" }],
					},
				],
			});
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: {
					app: { log: logMock() },
					session: { messages },
				},
				directory: TMP_DIR,
			} as any);

			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-prev", output);
			expect(output.prompt).toContain("<previous-summary>");
			expect(output.prompt).toContain("PRIOR SUMMARY");
		});

		it("keeps continuity across repeated compactions without duplication", async () => {
			const messages = mock().mockResolvedValue({
				data: [
					{
						info: { role: "assistant", summary: true, id: "s1" },
						parts: [{ type: "text", text: "FIRST SUMMARY" }],
					},
				],
			});
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: {
					app: { log: logMock() },
					session: { messages },
				},
				directory: TMP_DIR,
			} as any);

			const out1 = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-slide", out1);
			expect(out1.prompt).toContain("FIRST SUMMARY");

			// Same summary still present: continuity is preserved, emitted once.
			const out2 = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-slide", out2);
			expect(out2.prompt).toContain("FIRST SUMMARY");
			expect(out2.prompt!.split("FIRST SUMMARY")).toHaveLength(2);

			// A newer summary supersedes the carried one.
			messages.mockResolvedValue({
				data: [
					{
						info: { role: "assistant", summary: true, id: "s1" },
						parts: [{ type: "text", text: "FIRST SUMMARY" }],
					},
					{
						info: { role: "assistant", summary: true, id: "s2" },
						parts: [{ type: "text", text: "SECOND SUMMARY" }],
					},
				],
			});
			const out3 = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-slide", out3);
			expect(out3.prompt).toContain("SECOND SUMMARY");
		});

		it("injects the latest user ask into the replace prompt", async () => {
			const messages = mock().mockResolvedValue({
				data: [
					{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
					{
						info: { role: "user" },
						parts: [{ type: "text", text: "please fix the login bug" }],
					},
				],
			});
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: {
					app: { log: logMock() },
					session: { messages },
				},
				directory: TMP_DIR,
			} as any);

			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-ask", output);
			expect(output.prompt).toContain("<latest-user-ask>");
			expect(output.prompt).toContain("please fix the login bug");
		});

		it("does not fetch the previous summary in augment mode", async () => {
			const messages = mock().mockResolvedValue({ data: [] });
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: logMock() },
						session: { messages },
					},
					directory: TMP_DIR,
				} as any,
				{ promptMode: "augment" } as any,
			);
			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-aug2", output);
			expect(messages).not.toHaveBeenCalled();
		});
	});

	describe("constraint pinning (E6)", () => {
		it("injects pinned constraints into the prompt", async () => {
			const messages = mock().mockResolvedValue({
				data: [
					{
						info: { role: "user" },
						parts: [{ type: "text", text: "NEVER force push to main" }],
					},
				],
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: logMock() },
						session: { messages },
					},
					directory: TMP_DIR,
				} as any,
				{ pinning: { patterns: ["never force push"] } } as any,
			);
			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await compact(hooks, "sess-pin", output);
			expect(output.prompt).toContain("<pinned-constraints>");
			expect(output.prompt).toContain("NEVER force push to main");
		});

		it("does not trim pinned messages", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				pinning: { patterns: ["never force push"] },
			} as any);
			const longOutput = "x".repeat(5000);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "text", text: "NEVER force push" },
						{ type: "tool", tool: "bash", state: { output: longOutput } },
					],
				},
				...userTurns(5),
			];
			await transform(hooks, messages);
			expect((messages[0].parts[1] as any).state.output).toBe(longOutput);
		});

		it("validates pinned clauses against the newest summary", async () => {
			const logs: string[] = [];
			const messages = mock().mockResolvedValue({
				data: [
					{
						info: { role: "user" },
						parts: [{ type: "text", text: "NEVER force push to main" }],
					},
					{
						info: { role: "assistant", summary: true, id: "s1" },
						parts: [{ type: "text", text: "old summary without it" }],
					},
					{
						info: { role: "assistant", summary: true, id: "s2" },
						parts: [
							{
								type: "text",
								text: "new summary: NEVER force push to main",
							},
						],
					},
				],
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: {
							log: (input: { body: { message: string } }) => {
								logs.push(input.body.message);
								return Promise.resolve();
							},
						},
						session: { messages },
					},
					directory: TMP_DIR,
				} as any,
				{ debug: true, pinning: { patterns: ["never force push"] } } as any,
			);
			await compact(hooks, "sess-newest", { context: [] });
			await emit(hooks, "session.compacted", { sessionID: "sess-newest" });
			expect(logs).not.toContain("pinned constraints missing from summary");
		});
	});

	describe("adapter diagnostics", () => {
		it("warns about a misconfigured adapter even when debug is off", async () => {
			const logs: Array<{ level: string; message: string }> = [];
			await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: {
							log: (input: {
								body: { level: string; message: string };
							}) => {
								logs.push(input.body);
								return Promise.resolve();
							},
						},
					},
					directory: TMP_DIR,
				} as any,
				{ adapters: { embeddings: { provider: "mcp" } } } as any,
			);
			expect(
				logs.some(
					(entry) =>
						entry.level === "warn" &&
						entry.message.includes("mcp provider is not supported"),
				),
			).toBe(true);
		});
	});
});
