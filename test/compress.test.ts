import { describe, it, expect, beforeEach } from "bun:test";
import {
	CompressionStore,
	SquashStore,
	applyCompressions,
	applySquash,
	type CompressRequest,
	type SquashRequest,
} from "../src/core/compress.ts";
import {
	buildCompressToolDef,
	buildSquashToolDef,
} from "../src/opencode/tools.ts";

// ---------------------------------------------------------------------------
// buildCompressToolDef
// ---------------------------------------------------------------------------

describe("buildCompressToolDef()", () => {
	it("returns a valid tool definition with description, args and execute", () => {
		const def = buildCompressToolDef();
		expect(def.description).toContain("Compress");
		expect(def.args).toHaveProperty("topic");
		expect(def.args).toHaveProperty("start");
		expect(def.args).toHaveProperty("end");
		expect(def.args).toHaveProperty("summary");
		expect(def.args).toHaveProperty("scale");
		expect(typeof def.execute).toBe("function");
	});

	it("executes for auto-selected and explicit ranges", async () => {
		const def = buildCompressToolDef();
		expect(
			await def.execute({ topic: "T", summary: "S" }, {} as any),
		).toContain("auto-selected range");
		expect(
			await def.execute(
				{ topic: "T", summary: "S", start: 0, end: 1 },
				{} as any,
			),
		).toContain("messages 0-1");
	});
});

// ---------------------------------------------------------------------------
// CompressionStore: queue / drain / clear
// ---------------------------------------------------------------------------

describe("CompressionStore", () => {
	let store: CompressionStore;
	beforeEach(() => {
		store = new CompressionStore();
	});

	it("queues and drains compressions for a session", () => {
		store.queue("sess-1", {
			topic: "Test",
			start: 0,
			end: 5,
			summary: "Summary of messages 0-5",
			timestamp: 1000,
		});

		const drained = store.drain("sess-1");
		expect(drained).toHaveLength(1);
		expect(drained[0].topic).toBe("Test");
		expect(drained[0].summary).toBe("Summary of messages 0-5");
	});

	it("drain clears the queue", () => {
		store.queue("sess-2", {
			topic: "Test",
			start: 0,
			end: 3,
			summary: "Summary",
			timestamp: 1000,
		});

		store.drain("sess-2");
		const second = store.drain("sess-2");
		expect(second).toHaveLength(0);
	});

	it("returns empty array for unknown session", () => {
		const drained = store.drain("unknown");
		expect(drained).toHaveLength(0);
	});

	it("drains in reverse order by start index", () => {
		store.queue("sess-3", {
			topic: "First",
			start: 0,
			end: 3,
			summary: "First summary",
			timestamp: 1000,
		});
		store.queue("sess-3", {
			topic: "Second",
			start: 5,
			end: 8,
			summary: "Second summary",
			timestamp: 2000,
		});

		const drained = store.drain("sess-3");
		expect(drained).toHaveLength(2);
		// Should be sorted by start descending (process from end to start)
		expect(drained[0].start).toBe(5);
		expect(drained[1].start).toBe(0);
	});

	it("clear removes the queue for a session", () => {
		store.queue("sess-4", {
			topic: "Test",
			start: 0,
			end: 3,
			summary: "Summary",
			timestamp: 1000,
		});
		store.clear("sess-4");
		const drained = store.drain("sess-4");
		expect(drained).toHaveLength(0);
	});

	it("clearAll removes all queues", () => {
		store.queue("sess-5", {
			topic: "A",
			start: 0,
			end: 3,
			summary: "A",
			timestamp: 1000,
		});
		store.queue("sess-6", {
			topic: "B",
			start: 0,
			end: 3,
			summary: "B",
			timestamp: 2000,
		});
		store.clearAll();
		expect(store.drain("sess-5")).toHaveLength(0);
		expect(store.drain("sess-6")).toHaveLength(0);
	});

	it("keeps state per instance", () => {
		const a = new CompressionStore();
		const b = new CompressionStore();
		a.queue("s", {
			topic: "A",
			start: 0,
			end: 1,
			summary: "A",
			timestamp: 1000,
		});
		expect(a.drain("s")).toHaveLength(1);
		expect(b.drain("s")).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// applyCompressions
// ---------------------------------------------------------------------------

describe("applyCompressions()", () => {
	function makeMsg(role: string, text: string) {
		return {
			info: { role },
			parts: [{ type: "text", text }],
		};
	}

	it("returns 0 for empty requests", () => {
		const msgs = [makeMsg("user", "hello")];
		const count = applyCompressions(msgs as any, []);
		expect(count).toBe(0);
	});

	it("replaces a range with a summary", () => {
		const msgs = [
			makeMsg("user", "msg0"),
			makeMsg("assistant", "msg1"),
			makeMsg("user", "msg2"),
			makeMsg("assistant", "msg3"),
			makeMsg("user", "msg4"),
		];
		const requests: CompressRequest[] = [
			{
				topic: "Test",
				start: 1,
				end: 3,
				summary: "Summary of 1-3",
				timestamp: 1000,
			},
		];

		const count = applyCompressions(msgs as any, requests);
		expect(count).toBe(3);
		expect(msgs).toHaveLength(3); // 5 - 3 + 1 = 3
		// The summary should be at index 1
		expect(msgs[1].parts[0].text).toContain("Summary of 1-3");
		expect(msgs[1].parts[0].text).toContain("compressed-block");
		expect(msgs[1].parts[0].text).toContain('count="3"');
	});

	it("handles start out of bounds", () => {
		const msgs = [makeMsg("user", "msg0")];
		const requests: CompressRequest[] = [
			{
				topic: "Test",
				start: 5,
				end: 10,
				summary: "Summary",
				timestamp: 1000,
			},
		];
		const count = applyCompressions(msgs as any, requests);
		expect(count).toBe(0);
		expect(msgs).toHaveLength(1);
	});

	it("handles end beyond array length", () => {
		const msgs = [makeMsg("user", "msg0"), makeMsg("assistant", "msg1")];
		const requests: CompressRequest[] = [
			{
				topic: "Test",
				start: 0,
				end: 100,
				summary: "Summary",
				timestamp: 1000,
			},
		];
		const count = applyCompressions(msgs as any, requests);
		expect(count).toBe(2);
		expect(msgs).toHaveLength(1);
	});

	it("processes multiple requests from end to start", () => {
		const msgs = [
			makeMsg("user", "msg0"),
			makeMsg("assistant", "msg1"),
			makeMsg("user", "msg2"),
			makeMsg("assistant", "msg3"),
			makeMsg("user", "msg4"),
			makeMsg("assistant", "msg5"),
		];
		// Requests sorted by start descending (as drainCompressions returns)
		const requests: CompressRequest[] = [
			{
				topic: "Second",
				start: 4,
				end: 5,
				summary: "Summary 4-5",
				timestamp: 2000,
			},
			{
				topic: "First",
				start: 0,
				end: 1,
				summary: "Summary 0-1",
				timestamp: 1000,
			},
		];

		const count = applyCompressions(msgs as any, requests);
		expect(count).toBe(4); // 2 + 2
		// After first compression (4-5): [0,1,2,3, summary45] = 5 msgs
		// After second compression (0-1): [summary01, 2, 3, summary45] = 4 msgs
		expect(msgs).toHaveLength(4);
	});

	it("escapes HTML attributes in topic", () => {
		const msgs = [makeMsg("user", "msg0")];
		const requests: CompressRequest[] = [
			{
				topic: 'Test "quotes" & <tags>',
				start: 0,
				end: 0,
				summary: "Summary",
				timestamp: 1000,
			},
		];
		applyCompressions(msgs as any, requests);
		expect(msgs[0].parts[0].text).toContain("&quot;");
		expect(msgs[0].parts[0].text).toContain("&lt;");
		expect(msgs[0].parts[0].text).toContain("&gt;");
		expect(msgs[0].parts[0].text).toContain("&amp;");
	});

	it("handles start > end gracefully", () => {
		const msgs = [makeMsg("user", "msg0"), makeMsg("assistant", "msg1")];
		const requests: CompressRequest[] = [
			{
				topic: "Test",
				start: 3,
				end: 1,
				summary: "Summary",
				timestamp: 1000,
			},
		];
		const count = applyCompressions(msgs as any, requests);
		expect(count).toBe(0);
	});

	it("handles negative start", () => {
		const msgs = [makeMsg("user", "msg0"), makeMsg("assistant", "msg1")];
		const requests: CompressRequest[] = [
			{
				topic: "Test",
				start: -5,
				end: 0,
				summary: "Summary",
				timestamp: 1000,
			},
		];
		const count = applyCompressions(msgs as any, requests);
		expect(count).toBe(1);
		expect(msgs).toHaveLength(2); // 2 - 1 + 1 = 2
	});

	it("avoids a consecutive user message", () => {
		const msgs = [
			makeMsg("user", "u0"),
			makeMsg("assistant", "a1"),
			makeMsg("user", "u2"),
		];
		applyCompressions(msgs as any, [
			{ topic: "T", start: 1, end: 1, summary: "S", timestamp: 1000 },
		]);
		// Preceding message is a user message, so the block becomes assistant.
		expect(msgs[1].info.role).toBe("assistant");
	});

	it("uses user when the preceding message is assistant or absent", () => {
		const msgs = [makeMsg("assistant", "a0"), makeMsg("user", "u1")];
		applyCompressions(msgs as any, [
			{ topic: "T", start: 0, end: 0, summary: "S", timestamp: 1000 },
		]);
		expect(msgs[0].info.role).toBe("user");
	});

	it("auto-selects a deterministic span when no indices are given", () => {
		const msgs = [
			makeMsg("user", "u0"),
			makeMsg("assistant", "a0"),
			makeMsg("user", "u1"),
			makeMsg("assistant", "a1"),
			makeMsg("user", "u2"),
			makeMsg("assistant", "a2"),
			makeMsg("user", "u3"),
		];
		const count = applyCompressions(
			msgs as any,
			[{ topic: "Auto", summary: "AutoSummary", timestamp: 1000 }],
			{ protectedTurns: 3 },
		);
		expect(count).toBe(2);
		expect(msgs).toHaveLength(6);
		expect(msgs[0].parts[0].text).toContain("AutoSummary");
		expect(msgs[0].parts[0].text).toContain("compressed-block");
	});

	it("records the scale attribute", () => {
		const msgs = [makeMsg("user", "u0")];
		applyCompressions(msgs as any, [
			{
				topic: "T",
				start: 0,
				end: 0,
				summary: "S",
				scale: "granular",
				timestamp: 1000,
			},
		]);
		expect(msgs[0].parts[0].text).toContain('scale="granular"');
	});

	it("returns 0 when auto-selection finds nothing eligible", () => {
		const msgs = [makeMsg("user", "u0"), makeMsg("assistant", "a0")];
		const count = applyCompressions(
			msgs as any,
			[{ topic: "Auto", summary: "S", timestamp: 1000 }],
			{ protectedTurns: 3 },
		);
		expect(count).toBe(0);
	});

	it("assigns a durable id and a [bN] label", () => {
		const msgs = [
			{ info: { role: "user", timestamp: 7 }, parts: [{ type: "text", text: "u0" }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "a1" }] },
		];
		applyCompressions(msgs as any, [
			{ topic: "T", start: 0, end: 1, summary: "S", timestamp: 1000 },
		]);
		expect(msgs[0].parts[0].text).toContain('label="b0"');
		expect(msgs[0].parts[0].text).toContain("[b0]");
		expect(msgs[0].parts[0].text).toContain('id="u:7"');
	});
});

// ---------------------------------------------------------------------------
// squash
// ---------------------------------------------------------------------------

describe("buildSquashToolDef()", () => {
	it("exposes from/to/topic/summary and executes", async () => {
		const def = buildSquashToolDef();
		expect(def.description).toContain("Merge");
		expect(def.args).toHaveProperty("from");
		expect(def.args).toHaveProperty("to");
		expect(def.args).toHaveProperty("topic");
		expect(def.args).toHaveProperty("summary");
		expect(
			await def.execute(
				{ from: "b0", to: "b1", topic: "T", summary: "S" },
				{} as any,
			),
		).toContain("b0-b1");
	});
});

describe("SquashStore", () => {
	it("queues, drains and clears per session", () => {
		const store = new SquashStore();
		store.queue("s", {
			from: "b0",
			to: "b1",
			topic: "T",
			summary: "S",
			timestamp: 1,
		});
		expect(store.drain("s")).toHaveLength(1);
		expect(store.drain("s")).toHaveLength(0);
		store.queue("s", {
			from: "b0",
			to: "b1",
			topic: "T",
			summary: "S",
			timestamp: 1,
		});
		store.clear("s");
		expect(store.drain("s")).toHaveLength(0);
	});
});

describe("applySquash()", () => {
	function blockMsg(id: string, topic: string, text: string) {
		return {
			info: { role: "assistant" },
			parts: [
				{
					type: "text",
					text: `<compressed-block id="${id}" label="x" topic="${topic}">${text}</compressed-block>`,
				},
			],
		};
	}

	it("merges two contiguous blocks into one", () => {
		const msgs = [
			blockMsg("a", "A", "[b0]\n\nfirst"),
			blockMsg("b", "B", "[b1]\n\nsecond"),
		];
		const merged = applySquash(msgs as any, [
			{ from: "b0", to: "b1", topic: "Merged", summary: "combined", timestamp: 1 },
		]);
		expect(merged).toBe(2);
		expect(msgs).toHaveLength(1);
		expect(msgs[0].parts[0].text).toContain("combined");
		expect(msgs[0].parts[0].text).toContain('squashed="true"');
	});

	it("refuses a single-block request", () => {
		const msgs = [blockMsg("a", "A", "[b0]\n\nfirst")];
		const merged = applySquash(msgs as any, [
			{ from: "b0", to: "b0", topic: "T", summary: "S", timestamp: 1 },
		]);
		expect(merged).toBe(0);
		expect(msgs).toHaveLength(1);
	});

	it("refuses non-contiguous blocks", () => {
		const msgs = [
			blockMsg("a", "A", "[b0]\n\nfirst"),
			{ info: { role: "user" }, parts: [{ type: "text", text: "interrupt" }] },
			blockMsg("b", "B", "[b1]\n\nsecond"),
		];
		const merged = applySquash(msgs as any, [
			{ from: "b0", to: "b1", topic: "T", summary: "S", timestamp: 1 },
		]);
		expect(merged).toBe(0);
	});

	it("refuses unknown labels", () => {
		const msgs = [blockMsg("a", "A", "[b0]\n\nfirst")];
		const merged = applySquash(msgs as any, [
			{ from: "b0", to: "b9", topic: "T", summary: "S", timestamp: 1 },
		]);
		expect(merged).toBe(0);
	});

	it("refuses more blocks than maxBlocks", () => {
		const msgs = [
			blockMsg("a", "A", "[b0]\n\na"),
			blockMsg("b", "B", "[b1]\n\nb"),
			blockMsg("c", "C", "[b2]\n\nc"),
		];
		const merged = applySquash(
			msgs as any,
			[{ from: "b0", to: "b2", topic: "T", summary: "S", timestamp: 1 }],
			{ maxBlocks: 2 },
		);
		expect(merged).toBe(0);
	});
});
