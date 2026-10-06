import { describe, it, expect, beforeEach } from "vitest";
import {
	CompressionStore,
	applyCompressions,
	buildCompressToolDef,
	type CompressRequest,
} from "../src/compress.ts";

// ---------------------------------------------------------------------------
// buildCompressToolDef
// ---------------------------------------------------------------------------

describe("buildCompressToolDef()", () => {
	it("returns a tool definition with description and args", () => {
		const def = buildCompressToolDef();
		expect(def.description).toContain("Compress");
		expect(def.args).toHaveProperty("topic");
		expect(def.args).toHaveProperty("start");
		expect(def.args).toHaveProperty("end");
		expect(def.args).toHaveProperty("summary");
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
});
