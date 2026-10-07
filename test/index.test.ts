import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { LiveCompactionPlugin } from "../src/index.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = join(import.meta.dirname, "__tmp_index_test");
const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;

function setupTmp() {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
	mkdirSync(TMP_DIR, { recursive: true });
	mkdirSync(join(TMP_DIR, "xdg"), { recursive: true });
	// Isolate the global config dir so the machine's real config is not read.
	process.env.XDG_CONFIG_HOME = join(TMP_DIR, "xdg");
}

function cleanupTmp() {
	if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

// Access the internal session trackers map for testing
// We test through the public plugin interface only

describe("LiveCompactionPlugin", () => {
	const mockCtx = {
		client: { app: { log: mock().mockResolvedValue(undefined) } },
		project: { id: "test-project", name: "test" },
		directory: TMP_DIR,
		worktree: TMP_DIR,
		serverUrl: new URL("http://localhost:4096"),
	};

	async function getHooks() {
		return await LiveCompactionPlugin(mockCtx as any);
	}

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
				await hooks["experimental.session.compacting"]!({ sessionID }, output);
				expect(output.prompt, tool).toContain(filePath);
			}
		});

		it("ignores calls without sessionID or args", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{ tool: "read", sessionID: "", callID: "call-4", args: { filePath: "x.ts" } },
				{ title: "", output: "", metadata: {} },
			);
			await hooks["tool.execute.after"]!(
				{ tool: "read", sessionID: "sess-5", callID: "call-5", args: null as any },
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-5" },
				output,
			);
			expect(output.prompt).not.toContain("## Files Touched Manifest");
		});

		it("tracks multiple files in same session", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-multi",
					callID: "c1",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);
			await hooks["tool.execute.after"]!(
				{
					tool: "write",
					sessionID: "sess-multi",
					callID: "c2",
					args: { filePath: "b.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-multi" },
				output,
			);
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
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-compact" },
				output,
			);
			expect(output.prompt).toBeDefined();
			expect(output.prompt).toContain("## Brief");
			expect(output.prompt).toContain("## Task Continuity");
			expect(output.prompt).toContain("## Mandatory Reading");
		});

		it("includes files manifest when files were tracked", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-files",
					callID: "c1",
					args: { filePath: "readme.md" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-files" },
				output,
			);
			expect(output.prompt).toContain("## Files Touched");
			expect(output.prompt).toContain("readme.md");
		});

		it("clears tracker after compaction", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-clear",
					callID: "c1",
					args: { filePath: "x.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// First compaction should include the file
			const output1 = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-clear" },
				output1,
			);
			expect(output1.prompt).toContain("x.ts");

			// Second compaction should NOT include the file (tracker was cleared)
			const output2 = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-clear" },
				output2,
			);
			expect(output2.prompt).not.toContain("x.ts");
		});

		it("works without any tracked files", async () => {
			const hooks = await getHooks();
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-empty" },
				output,
			);
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
				await hooks["experimental.session.compacting"]!({ sessionID }, output);
				expect(output.prompt, sessionID).not.toContain(filePath);
			}
		});

		it("ignores other event types", async () => {
			const hooks = await getHooks();
			// Should not throw
			await hooks.event!({
				event: { id: "evt-2", type: "session.updated", properties: {} },
			});
		});
	});

	// ---------------------------------------------------------------------------
	// dispose
	// ---------------------------------------------------------------------------

	describe("dispose", () => {
		it("clears all session trackers", async () => {
			const hooks = await getHooks();

			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-a",
					callID: "c1",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);
			await hooks["tool.execute.after"]!(
				{
					tool: "write",
					sessionID: "sess-b",
					callID: "c2",
					args: { filePath: "b.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			await hooks.dispose!();

			// Both sessions should be cleared
			const outputA = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-a" },
				outputA,
			);
			expect(outputA.prompt).not.toContain("a.ts");

			const outputB = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-b" },
				outputB,
			);
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
			// Tool at index 1, followed by 5 user turns to push it out of the window
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "bash", state: { output: longOutput } },
					],
				},
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];

			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			const firstPass = (messages[0].parts[0] as any).state.output;
			expect(firstPass).toContain("[trimmed");

			// Second pass must be a no-op on the already trimmed output.
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			// First should be deduped
			expect(messages[0].parts[0].state.output).toContain("deduped");
			// Second should be preserved
			expect(messages[1].parts[0].state.output).toBe("new content");
		});

		it("purges large inputs from errored tools outside the recent window", async () => {
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
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});

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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});

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
			await hooks["tool.execute.after"]!(
				{
					tool: "compress",
					sessionID: "sess-compress",
					callID: "c-comp",
					args: {
						topic: "Auth Bug Fix",
						start: 0,
						end: 3,
						summary: "Fixed the auth bug by updating login.ts",
					},
				},
				{ title: "", output: "", metadata: {} },
			);

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

			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});

			// Messages 0-3 should have been compressed into one
			expect(messages).toHaveLength(2); // 5 - 4 + 1 = 2
			expect(messages[0].parts[0].text).toContain("Auth Bug Fix");
			expect(messages[0].parts[0].text).toContain("compressed-block");
			expect(messages[1].parts[0].text).toBe("next task");
		});

		it("exposes a squash tool and merges contiguous blocks", async () => {
			const hooks = await getHooks();
			expect((hooks as any).tool.squash).toBeDefined();

			await hooks["tool.execute.after"]!(
				{
					tool: "squash",
					sessionID: "sess-squash",
					callID: "c-sq",
					args: { from: "b0", to: "b1", topic: "Merged", summary: "combined" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const block = (id: string, label: string, body: string) => ({
				info: { role: "assistant" },
				parts: [
					{
						type: "text",
						text: `<compressed-block id="${id}" label="${label}">${body}</compressed-block>`,
					},
				],
			});
			const messages = [
				block("a", "b0", "[b0]\n\nfirst"),
				block("b", "b1", "[b1]\n\nsecond"),
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages).toHaveLength(1);
			expect(messages[0].parts[0].text).toContain("combined");
		});

		it("does not apply a compression to a different session's messages", async () => {
			const hooks = await getHooks();

			await hooks["tool.execute.after"]!(
				{
					tool: "compress",
					sessionID: "sess-A",
					callID: "c-A",
					args: { topic: "A", start: 0, end: 1, summary: "sumA" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// Transform a conversation that does NOT contain c-A: untouched.
			const other = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "y" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages: other,
			});
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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages: own,
			});
			expect(own).toHaveLength(2); // 3 - 2 + 1 = 2
			expect((own[0].parts[0] as any).text).toContain("sumA");
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
						app: { log: mock().mockResolvedValue(undefined) },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await hooks.event!({
				event: {
					id: "e",
					type: "message.updated",
					properties: {
						info: {
							sessionID: "sess-low",
							role: "assistant",
							providerID: "prov",
							modelID: "model-x",
							finish: "stop",
							tokens: { input: 100 },
						},
					},
				},
			});

			await hooks["tool.execute.after"]!(
				{
					tool: "compress",
					sessionID: "sess-low",
					callID: "c-low",
					args: { topic: "T", start: 0, end: 1, summary: "S" },
				},
				{ title: "", output: "", metadata: {} },
			);

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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages: msgs,
			});
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
						app: { log: mock().mockResolvedValue(undefined) },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await hooks.event!({
				event: {
					id: "e",
					type: "message.updated",
					properties: {
						info: {
							sessionID: "sess-high",
							role: "assistant",
							providerID: "prov",
							modelID: "model-x",
							finish: "stop",
							tokens: { input: 900 },
						},
					},
				},
			});

			await hooks["tool.execute.after"]!(
				{
					tool: "compress",
					sessionID: "sess-high",
					callID: "c-high",
					args: { topic: "T", start: 0, end: 1, summary: "S" },
				},
				{ title: "", output: "", metadata: {} },
			);

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
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages: msgs,
			});
			expect(msgs).toHaveLength(2);
			expect((msgs[0].parts[0] as any).text).toContain("S");
		});

		it("restores original messages via expand", async () => {
			const hooks = await getHooks();

			await hooks["tool.execute.after"]!(
				{
					tool: "compress",
					sessionID: "sess-expand",
					callID: "",
					args: { topic: "T", start: 0, end: 1, summary: "S" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const messages = [
				{
					info: { role: "user", timestamp: 1 },
					parts: [{ type: "text", text: "orig1" }],
				},
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "orig2" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "keep" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages).toHaveLength(2);
			expect(messages[0].parts[0].text).toContain("[b0]");

			await hooks["tool.execute.after"]!(
				{
					tool: "expand",
					sessionID: "sess-expand",
					callID: "c-expand",
					args: { block: "b0" },
				},
				{ title: "", output: "", metadata: {} },
			);
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages).toHaveLength(3);
			expect(messages[0].parts[0].text).toBe("orig1");
			expect(messages[1].parts[0].text).toBe("orig2");
		});

		it("drops stale deferred compressions", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "compress",
					sessionID: "sess-stale",
					callID: "c-stale",
					args: { topic: "Old", start: 0, end: 1, summary: "old" },
				},
				{ title: "", output: "", metadata: {} },
			);

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
				await hooks["experimental.chat.messages.transform"]!({} as any, {
					messages: own,
				});
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
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-todo" },
				output,
			);
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
				client: { app: { log: mock().mockResolvedValue(undefined) }, session: { todo } },
				directory: TMP_DIR,
			} as any);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-task" },
				output,
			);
			expect(output.prompt).toContain("<task-state>");
			expect(output.prompt).toContain("- [~] write tests");
			expect(output.prompt).toContain("status=in_progress");
		});

		it("does not throw when the todo API is unavailable", async () => {
			const hooks = await getHooks();
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-no-todo" },
				output,
			);
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
						app: { log: mock().mockResolvedValue(undefined) },
						session: { summarize },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await hooks.event!({
				event: {
					id: "e",
					type: "message.updated",
					properties: {
						info: {
							id: "m1",
							sessionID: "sess-preempt",
							role: "assistant",
							providerID: "prov",
							modelID: "model-x",
							finish: "stop",
							tokens: { input: 900, cache: { read: 0, write: 0 } },
						},
					},
				},
			});

			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-preempt",
					callID: "c1",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

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
						app: { log: mock().mockResolvedValue(undefined) },
						session: { summarize },
						provider: { list },
					},
					directory: TMP_DIR,
				} as any,
				{ preemptiveCompaction: { enabled: true } } as any,
			);

			await hooks.event!({
				event: {
					id: "e",
					type: "message.updated",
					properties: {
						info: {
							sessionID: "sess-turn",
							role: "assistant",
							providerID: "prov",
							modelID: "model-x",
							finish: "stop",
							tokens: { input: 900 },
						},
					},
				},
			});

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
						app: { log: mock().mockResolvedValue(undefined) },
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

			await hooks.event!({
				event: {
					id: "e",
					type: "message.updated",
					properties: {
						info: {
							sessionID: "sess-tail",
							role: "assistant",
							providerID: "prov",
							modelID: "model-x",
							finish: "stop",
							tokens: { input: 900 },
						},
					},
				},
			});
			expect(summarize).not.toHaveBeenCalled();

			for (let i = 0; i < 3; i++) {
				await hooks["tool.execute.after"]!(
					{
						tool: "read",
						sessionID: "sess-tail",
						callID: `c${i}`,
						args: { filePath: "a.ts" },
					},
					{ title: "", output: "", metadata: {} },
				);
			}

			expect(summarize).toHaveBeenCalledTimes(1);
		});

		it("does not trigger when disabled", async () => {
			const summarize = mock().mockResolvedValue(undefined);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: {
					app: { log: mock().mockResolvedValue(undefined) },
					session: { summarize },
					provider: { list: mock() },
				},
				directory: TMP_DIR,
			} as any);

			await hooks.event!({
				event: {
					id: "e",
					type: "message.updated",
					properties: {
						info: {
							sessionID: "sess-off",
							role: "assistant",
							providerID: "prov",
							modelID: "model-x",
							finish: "stop",
							tokens: { input: 999_999 },
						},
					},
				},
			});
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-off",
					callID: "c",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);
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
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-aug" },
				output,
			);
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

			await hooks.event!({
				event: {
					id: "e1",
					type: "session.compacted",
					properties: { sessionID: "sess-deg" },
				},
			});
			await hooks.event!({
				event: {
					id: "e2",
					type: "message.updated",
					properties: {
						info: {
							sessionID: "sess-deg",
							role: "assistant",
							finish: "stop",
						},
					},
				},
			});

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
					app: { log: mock().mockResolvedValue(undefined) },
					session: { messages },
				},
				directory: TMP_DIR,
			} as any);

			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-prev" },
				output,
			);
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
					app: { log: mock().mockResolvedValue(undefined) },
					session: { messages },
				},
				directory: TMP_DIR,
			} as any);

			const out1 = { context: [] as string[], prompt: undefined as string | undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-slide" },
				out1,
			);
			expect(out1.prompt).toContain("FIRST SUMMARY");

			// Same summary still present: continuity is preserved.
			const out2 = { context: [] as string[], prompt: undefined as string | undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-slide" },
				out2,
			);
			expect(out2.prompt).toContain("FIRST SUMMARY");

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
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-slide" },
				out3,
			);
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
					app: { log: mock().mockResolvedValue(undefined) },
					session: { messages },
				},
				directory: TMP_DIR,
			} as any);

			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-ask" },
				output,
			);
			expect(output.prompt).toContain("<latest-user-ask>");
			expect(output.prompt).toContain("please fix the login bug");
		});

		it("does not fetch the previous summary in augment mode", async () => {
			const messages = mock().mockResolvedValue({ data: [] });
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: mock().mockResolvedValue(undefined) },
						session: { messages },
					},
					directory: TMP_DIR,
				} as any,
				{ promptMode: "augment" } as any,
			);
			const output = { context: [] as string[], prompt: undefined as string | undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-aug2" },
				output,
			);
			expect(messages).not.toHaveBeenCalled();
		});
	});
});
