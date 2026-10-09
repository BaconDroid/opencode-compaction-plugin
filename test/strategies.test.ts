import { describe, it, expect } from "bun:test";
import {
	toolCallKey,
	applyDedup,
	findErroredParts,
	applyPurgeErrors,
	applyCascadePurge,
} from "../src/core/strategies.ts";
import { mergeConfig } from "../src/config/config.ts";

describe("toolCallKey()", () => {
	it("is deterministic and distinguishes tools and args", () => {
		expect(toolCallKey("read", { filePath: "a.ts" })).toBe(
			toolCallKey("read", { filePath: "a.ts" }),
		);
		expect(toolCallKey("read", { filePath: "a.ts" })).not.toBe(
			toolCallKey("write", { filePath: "a.ts" }),
		);
		expect(toolCallKey("read", { filePath: "a.ts" })).not.toBe(
			toolCallKey("read", { filePath: "b.ts" }),
		);
		// Sorted keys for determinism.
		expect(toolCallKey("bash", { command: "ls", cwd: "/tmp" })).toBe(
			toolCallKey("bash", { cwd: "/tmp", command: "ls" }),
		);
		expect(typeof toolCallKey("tool", null)).toBe("string");
		expect(typeof toolCallKey("tool", undefined)).toBe("string");
		expect(toolCallKey("tool", 42)).not.toBe(toolCallKey("tool", "hello"));
	});

	it("sorts keys nested inside arrays", () => {
		expect(
			toolCallKey("edit", { edits: [{ a: 1, b: 2 }] }),
		).toBe(toolCallKey("edit", { edits: [{ b: 2, a: 1 }] }));
	});
});

describe("applyDedup()", () => {
	const msg = (tool: string, args: unknown, output?: string, state: Record<string, unknown> = {}) => ({
		info: { role: "assistant" },
		parts: [{ type: "tool", tool, args, state: { ...state, ...(output === undefined ? {} : { output }) } }],
	});

	it("returns 0 when disabled", () => {
		const cfg = mergeConfig({ dedup: { enabled: false } });
		const msgs = [
			msg("read", { filePath: "a.ts" }, "content1"),
			msg("read", { filePath: "a.ts" }, "content2"),
		];
		expect(applyDedup(msgs as never, cfg)).toBe(0);
		expect(msgs[0].parts[0].state.output).toBe("content1");
	});

	it("keeps only the last of identical calls, key-sorted", () => {
		const cfg = mergeConfig({});
		const msgs = [
			msg("bash", { command: "ls" }, "v1"),
			msg("bash", { command: "ls" }, "v2"),
			msg("bash", { command: "ls" }, "v3"),
			msg("bash", { command: "ls", cwd: "/tmp" }, "w1"),
			msg("bash", { cwd: "/tmp", command: "ls" }, "w2"),
		];
		expect(applyDedup(msgs as never, cfg)).toBe(3);
		expect(msgs[0].parts[0].state.output).toContain("deduped");
		expect(msgs[1].parts[0].state.output).toContain("deduped");
		expect(msgs[2].parts[0].state.output).toBe("v3");
		expect(msgs[3].parts[0].state.output).toContain("deduped");
		expect(msgs[4].parts[0].state.output).toBe("w2");
	});

	it("does not dedup different tools/args or protected tools", () => {
		const diff = [
			msg("read", { filePath: "a.ts" }, "1"),
			msg("write", { filePath: "a.ts" }, "2"),
			msg("read", { filePath: "b.ts" }, "3"),
		];
		expect(applyDedup(diff as never, mergeConfig({}))).toBe(0);

		const prot = [
			msg("bash", { command: "ls" }, "v1"),
			msg("bash", { command: "ls" }, "v2"),
		];
		expect(
			applyDedup(prot as never, mergeConfig({ dedup: { protectedTools: ["bash"] } })),
		).toBe(0);
	});

	it("ignores parts without output, non-tool parts and errored calls", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
			{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "read", args: { filePath: "a.ts" } }] },
			{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "read", args: { filePath: "a.ts" }, state: { status: "error", error: "boom" } }] },
			msg("read", { filePath: "a.ts" }, "ok"),
		];
		expect(applyDedup(msgs as never, cfg)).toBe(0);
		expect((msgs[2].parts[0].state as { error?: string }).error).toBe("boom");
	});

	it("is idempotent across transform passes", () => {
		const cfg = mergeConfig({});
		const msgs = [
			msg("bash", { command: "ls" }, "v1"),
			msg("bash", { command: "ls" }, "v2"),
		];
		expect(applyDedup(msgs as never, cfg)).toBe(1);
		const marker = msgs[0].parts[0].state.output;
		expect(applyDedup(msgs as never, cfg)).toBe(0);
		expect(msgs[0].parts[0].state.output).toBe(marker);
	});
});

describe("findErroredParts()", () => {
	it("finds only error-status tool parts", () => {
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{ type: "tool", tool: "bash", state: { status: "error", output: "e1" } },
					{ type: "tool", tool: "bash", state: { status: "error", output: "e2" } },
					{ type: "tool", tool: "bash", state: { status: "success", output: "ok" } },
					{ type: "tool", tool: "bash", state: { status: "failed", output: "killed" } },
					{ type: "text", text: "x" },
					{ type: "tool", tool: "bash" },
				],
			},
		];
		expect(findErroredParts(msgs as never)).toEqual([
			{ msgIdx: 0, partIdx: 0 },
			{ msgIdx: 0, partIdx: 1 },
		]);
	});
});

describe("applyPurgeErrors()", () => {
	const errored = (state: Record<string, unknown>) => [
		{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "bash", callID: "call-err", state: { status: "error", ...state } }] },
	];

	it("returns 0 when disabled", () => {
		const cfg = mergeConfig({ purgeErrors: { enabled: false } });
		const msgs = errored({ output: "fail", input: "x".repeat(200) });
		expect(applyPurgeErrors(msgs as never, cfg)).toBe(0);
		expect(msgs[0].parts[0].state.input).toBe("x".repeat(200));
	});

	it("purges large string and object inputs", () => {
		const cfg = mergeConfig({});
		const str = errored({ output: "fail", input: "x".repeat(500) });
		expect(applyPurgeErrors(str as never, cfg)).toBe(1);
		expect((str[0].parts[0].state.input as { purged: string }).purged).toContain("500 chars");

		const obj = errored({ input: { command: "x".repeat(500) } });
		expect(applyPurgeErrors(obj as never, cfg)).toBe(1);
		expect((obj[0].parts[0].state.input as { purged: string }).purged).toContain("removed");
	});

	it("preserves small inputs and parts without input", () => {
		const cfg = mergeConfig({});
		const small = errored({ output: "fail", input: "short input" });
		expect(applyPurgeErrors(small as never, cfg)).toBe(0);
		expect(small[0].parts[0].state.input).toBe("short input");

		const none = errored({ output: "fail" });
		expect(applyPurgeErrors(none as never, cfg)).toBe(0);
	});

	it("purges the whole attempt by default and preserves output when disabled", () => {
		const input = "x".repeat(200);
		const def = errored({ output: "ENOENT: no such file", input });
		applyPurgeErrors(def as never, mergeConfig({}));
		expect(def[0].parts[0].state.output).toContain("[purged failed bash:");
		expect(def[0].parts[0].state.output).toContain("ENOENT");

		const keep = errored({ output: "ENOENT: no such file", input });
		applyPurgeErrors(
			keep as never,
			mergeConfig({ purgeErrors: { wholeAttempt: false } }),
		);
		expect(keep[0].parts[0].state.output).toBe("ENOENT: no such file");
	});

	it("reports purged call ids and skips protected indices", () => {
		const cfg = mergeConfig({});
		const ids = new Set<string>();
		const msgs = errored({ output: "fail", input: "x".repeat(200) });
		applyPurgeErrors(msgs as never, cfg, undefined, ids);
		expect(ids).toEqual(new Set(["call-err"]));

		const protectedMsgs = errored({ output: "fail", input: "x".repeat(200) });
		expect(applyPurgeErrors(protectedMsgs as never, cfg, new Set([0]))).toBe(0);
		expect(protectedMsgs[0].parts[0].state.input).toBe("x".repeat(200));
	});

	it("purges the input wherever it is stored (args and state.input)", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						callID: "c",
						args: { command: "x".repeat(200) },
						state: {
							status: "error",
							output: "fail",
							input: { command: "x".repeat(200) },
						},
					},
				],
			},
		];
		expect(applyPurgeErrors(msgs as never, cfg)).toBe(1);
		expect((msgs[0].parts[0] as { args: { purged: string } }).args.purged).toContain(
			"chars",
		);
		expect(
			(msgs[0].parts[0].state.input as { purged: string }).purged,
		).toContain("chars");
	});

	it("re-reports already-purged call ids so a later cascade can run", () => {
		const cfg = mergeConfig({});
		const msgs = errored({ output: "fail", input: "x".repeat(200) });
		const first = new Set<string>();
		applyPurgeErrors(msgs as never, cfg, undefined, first);
		expect(first.has("call-err")).toBe(true);

		const second = new Set<string>();
		expect(applyPurgeErrors(msgs as never, cfg, undefined, second)).toBe(0);
		expect(second.has("call-err")).toBe(true);
	});
});

describe("applyCascadePurge()", () => {
	const call = (callID: string, input: unknown) => ({
		info: { role: "assistant" },
		parts: [{ type: "tool", tool: "bash", callID, state: { status: "success", output: "ok", input } }],
	});

	it("returns 0 for an empty purged set", () => {
		expect(applyCascadePurge([call("a", { x: 1 })] as never, new Set())).toBe(0);
	});

	it("purges descendants leaf-first and leaves unrelated calls", () => {
		const msgs = [
			call("callA", { command: "run A" }),
			call("callB", { command: "use callA" }),
			call("callC", { command: "use callB" }),
			call("callX", { command: "independent" }),
		];
		expect(applyCascadePurge(msgs as never, new Set(["callA"]))).toBe(2);
		expect((msgs[1].parts[0].state.input as { purged: string }).purged).toContain("cascade");
		expect((msgs[2].parts[0].state.input as { purged: string }).purged).toContain("cascade");
		expect((msgs[0].parts[0].state.input as { purged?: string }).purged).toBeUndefined();
		expect((msgs[3].parts[0].state.input as { purged?: string }).purged).toBeUndefined();
	});

	it("skips protected message indices", () => {
		const msgs = [call("callA", { command: "run A" }), call("callB", { command: "use callA" })];
		expect(applyCascadePurge(msgs as never, new Set(["callA"]), new Set([1]))).toBe(0);
		expect((msgs[1].parts[0].state.input as { purged?: string }).purged).toBeUndefined();
	});

	it("does not cascade onto calls that only share a callID prefix", () => {
		const msgs = [
			call("abc", { command: "run" }),
			call("abcdef", { command: "use abcdef" }),
		];
		expect(applyCascadePurge(msgs as never, new Set(["abc"]))).toBe(0);
		expect(
			(msgs[1].parts[0].state.input as { purged?: string }).purged,
		).toBeUndefined();
	});

	it("does not purge a dependency cycle", () => {
		const msgs = [
			call("callA", { command: "use callB and callC" }),
			call("callB", { command: "use callA" }),
			call("callC", { command: "run" }),
		];
		// callA depends on callC, so callA and the A<->B cycle are contaminated,
		// but neither cycle member ever has all its dependents purged.
		expect(applyCascadePurge(msgs as never, new Set(["callC"]))).toBe(0);
		expect((msgs[0].parts[0].state.input as { purged?: string }).purged).toBeUndefined();
		expect((msgs[1].parts[0].state.input as { purged?: string }).purged).toBeUndefined();
	});
});
