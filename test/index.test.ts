import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
		client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
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
		vi.clearAllMocks();
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
			expect(hooks["command.execute.before"]).toBeTypeOf("function");
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
			const logSpy = vi.fn().mockResolvedValue(undefined);
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
		it("records read operations", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-1",
					callID: "call-1",
					args: { filePath: "src/a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// Verify by checking compaction prompt includes the file
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-1" },
				output,
			);
			expect(output.prompt).toContain("src/a.ts");
		});

		it("records write operations", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "write",
					sessionID: "sess-2",
					callID: "call-2",
					args: { filePath: "lib/b.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-2" },
				output,
			);
			expect(output.prompt).toContain("lib/b.ts");
		});

		it("records edit operations", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "edit",
					sessionID: "sess-3",
					callID: "call-3",
					args: { filePath: "cfg.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-3" },
				output,
			);
			expect(output.prompt).toContain("cfg.ts");
		});

		it("ignores calls without sessionID", async () => {
			const hooks = await getHooks();
			// Should not throw
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "",
					callID: "call-4",
					args: { filePath: "x.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);
		});

		it("ignores calls without args", async () => {
			const hooks = await getHooks();
			// Should not throw
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-5",
					callID: "call-5",
					args: null as any,
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-5" },
				output,
			);
			// No files manifest should appear
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

		it("includes focus directive when set via /compact focus", async () => {
			const hooks = await getHooks();

			// First, trigger a tool call to register the session
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-focus",
					callID: "c1",
					args: { filePath: "x.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// Set focus via the built-in /compact with a focus argument.
			await hooks["command.execute.before"]!(
				{
					command: "compact",
					sessionID: "sess-focus",
					arguments: "focus Fix the auth bug",
				},
				{ parts: [] },
			);

			// Compaction should include the focus directive
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-focus" },
				output,
			);
			expect(output.prompt).toContain("Fix the auth bug");
			expect(output.prompt).toContain("<focus-directive>");
		});

		it("applies the focus directive to only one compaction", async () => {
			const hooks = await getHooks();

			await hooks["command.execute.before"]!(
				{
					command: "compact",
					sessionID: "sess-f1",
					arguments: "focus Only once",
				},
				{ parts: [] },
			);

			const first = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-f1" },
				first,
			);
			expect(first.prompt).toContain("Only once");

			const second = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-f2" },
				second,
			);
			expect(second.prompt).not.toContain("Only once");
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
	// command.execute.before (slash commands)
	// ---------------------------------------------------------------------------

	describe("command.execute.before", () => {
		it("ignores non-compact commands", async () => {
			const hooks = await getHooks();
			await hooks["command.execute.before"]!(
				{ command: "other", sessionID: "sess-cmd", arguments: "focus X" },
				{ parts: [] },
			);
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-cmd" },
				output,
			);
			expect(output.prompt).not.toContain("<focus-directive>");
		});

		it("does not set a focus for plain /compact", async () => {
			const hooks = await getHooks();
			await hooks["command.execute.before"]!(
				{ command: "compact", sessionID: "sess-cmd2", arguments: "" },
				{ parts: [] },
			);
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-cmd2" },
				output,
			);
			expect(output.prompt).not.toContain("<focus-directive>");
		});

		it("stores the focus directive from /compact focus <directive>", async () => {
			const hooks = await getHooks();
			await hooks["command.execute.before"]!(
				{
					command: "compact",
					sessionID: "sess-cmd3",
					arguments: "focus Fix login bug",
				},
				{ parts: [] },
			);
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-cmd3" },
				output,
			);
			expect(output.prompt).toContain("Fix login bug");
		});

		it("ignores /compact focus with an empty directive", async () => {
			const hooks = await getHooks();
			await hooks["command.execute.before"]!(
				{ command: "compact", sessionID: "sess-cmd4", arguments: "focus   " },
				{ parts: [] },
			);
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-cmd4" },
				output,
			);
			expect(output.prompt).not.toContain("<focus-directive>");
		});

		it("scopes the focus directive to the command's session", async () => {
			const hooks = await getHooks();

			await hooks["command.execute.before"]!(
				{
					command: "compact",
					sessionID: "sess-scoped",
					arguments: "focus Scoped goal",
				},
				{ parts: [] },
			);

			// A different session must not receive the directive.
			const other = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-other" },
				other,
			);
			expect(other.prompt).not.toContain("Scoped goal");

			// The owning session receives and consumes it.
			const own = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-scoped" },
				own,
			);
			expect(own.prompt).toContain("Scoped goal");
		});
	});

	// ---------------------------------------------------------------------------
	// event handler
	// ---------------------------------------------------------------------------

	describe("event", () => {
		it("cleans up trackers on session.deleted", async () => {
			const hooks = await getHooks();

			// Track a file
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-del",
					callID: "c1",
					args: { filePath: "y.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// Delete session
			await hooks.event!({
				event: {
					id: "evt-1",
					type: "session.deleted",
					properties: { sessionID: "sess-del" },
				},
			});

			// After deletion, compaction should not have the file
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-del" },
				output,
			);
			// New tracker was created for the session (it was deleted), so no files
			expect(output.prompt).not.toContain("y.ts");
		});

		it("cleans up trackers on session.deleted with the SDK payload shape", async () => {
			const hooks = await getHooks();

			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-del2",
					callID: "c1",
					args: { filePath: "z.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			await hooks.event!({
				event: {
					id: "evt-2",
					type: "session.deleted",
					properties: { info: { id: "sess-del2" } },
				},
			});

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-del2" },
				output,
			);
			expect(output.prompt).not.toContain("z.ts");
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

		it("handles messages without tool parts", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "hello" }],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].text).toBe("hello");
		});

		it("handles parts without state", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "assistant" },
					parts: [{ type: "tool", tool: "bash" }],
				},
			];
			// Should not throw
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
		});

		it("handles parts without tool name", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "assistant" },
					parts: [{ type: "tool", state: { output: "something" } }],
				},
			];
			// Should not modify (no tool name)
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].state.output).toBe("something");
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
	// config (slash command registration)
	// ---------------------------------------------------------------------------

	describe("config", () => {
		it("does not override the built-in /compact command", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.command).toBeUndefined();
		});

		it("honors plugin options", async () => {
			const hooks = await LiveCompactionPlugin(mockCtx as any, {
				commands: { enabled: false },
			} as any);
			const opencodeConfig: Record<string, unknown> = {};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.command).toBeUndefined();
		});

		it("does not corrupt a global permission string", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = { permission: "allow" };
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.permission).toBe("allow");
		});

		it("adds the compress permission to an object permission", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {
				permission: { bash: "ask" },
			};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.permission).toEqual({
				bash: "ask",
				compress: "allow",
			});
		});

		it("respects an explicit compress deny", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {
				permission: { compress: "deny" },
			};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.permission).toEqual({ compress: "deny" });
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
							args: { filePath: "src/vitest.config.ts" },
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
			const logSpy = vi.fn().mockResolvedValue(undefined);
			const todo = vi
				.fn()
				.mockResolvedValue({ data: [{ content: "x", status: "pending" }] });
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
			const summarize = vi.fn().mockResolvedValue(undefined);
			const list = vi.fn().mockResolvedValue({
				all: [{ id: "prov", models: { "model-x": { limit: { context: 1000 } } } }],
			});
			const hooks = await LiveCompactionPlugin(
				{
					...mockCtx,
					client: {
						app: { log: vi.fn().mockResolvedValue(undefined) },
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

		it("does not trigger when disabled", async () => {
			const summarize = vi.fn().mockResolvedValue(undefined);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				client: {
					app: { log: vi.fn().mockResolvedValue(undefined) },
					session: { summarize },
					provider: { list: vi.fn() },
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
			const log = vi.fn().mockResolvedValue(undefined);
			const messages = vi.fn().mockResolvedValue([
				{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
			]);
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
});
