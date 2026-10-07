import { describe, it, expect } from "vitest";
import {
	messageHasText,
	countTrailingNoTextAssistant,
	textDistance,
	shpShouldHalt,
	DegradationMonitor,
} from "../src/degradation-monitor.ts";

describe("messageHasText()", () => {
	it("detects a non-empty text part", () => {
		expect(messageHasText([{ type: "text", text: "hi" }])).toBe(true);
	});

	it("ignores empty text and non-text parts", () => {
		expect(messageHasText([{ type: "text", text: "   " }])).toBe(false);
		expect(messageHasText([{ type: "tool" }])).toBe(false);
	});

	it("returns false for non-arrays", () => {
		expect(messageHasText(undefined)).toBe(false);
	});
});

describe("countTrailingNoTextAssistant()", () => {
	it("counts trailing assistant messages without text", () => {
		const messages = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
			{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
			{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
		];
		expect(countTrailingNoTextAssistant(messages)).toBe(2);
	});

	it("stops at a message with text", () => {
		const messages = [
			{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] },
		];
		expect(countTrailingNoTextAssistant(messages)).toBe(0);
	});

	it("stops at a non-assistant message", () => {
		const messages = [
			{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
			{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
		];
		expect(countTrailingNoTextAssistant(messages)).toBe(0);
	});
});

describe("DegradationMonitor", () => {
	it("checks only within the window after compaction", () => {
		const monitor = new DegradationMonitor();
		expect(monitor.shouldCheck("s", 1000, 100)).toBe(false);
		monitor.markCompacted("s", 1000);
		expect(monitor.shouldCheck("s", 1050, 100)).toBe(true);
		expect(monitor.shouldCheck("s", 1200, 100)).toBe(false);
	});

	it("clear removes the marker", () => {
		const monitor = new DegradationMonitor();
		monitor.markCompacted("a", 0);
		monitor.clear("a");
		expect(monitor.shouldCheck("a", 0, 100)).toBe(false);
	});
});

describe("textDistance()", () => {
	it("returns 0 for identical text", () => {
		expect(textDistance("hello world", "Hello   World")).toBe(0);
	});

	it("returns 1 when one side is empty", () => {
		expect(textDistance("", "x")).toBe(1);
		expect(textDistance("x", "")).toBe(1);
		expect(textDistance("", "")).toBe(0);
	});

	it("is between 0 and 1 for partial overlap", () => {
		const d = textDistance("the quick brown fox", "the quick blue fox");
		expect(d).toBeGreaterThan(0);
		expect(d).toBeLessThan(1);
	});
});

describe("shpShouldHalt()", () => {
	const config = {
		convergenceThreshold: 0.1,
		convergencePatience: 3,
		maxRounds: 12,
	};

	it("does not halt while distances are high", () => {
		expect(shpShouldHalt(2, [0.5, 0.6, 0.7], config).shouldHalt).toBe(false);
	});

	it("halts on entropy when the last k distances converge", () => {
		const decision = shpShouldHalt(5, [0.5, 0.01, 0.02, 0.03], config);
		expect(decision.shouldHalt).toBe(true);
		expect(decision.reason).toBe("entropy");
	});

	it("halts at maxRounds as a failsafe", () => {
		const decision = shpShouldHalt(12, [0.5, 0.5], config);
		expect(decision.shouldHalt).toBe(true);
		expect(decision.reason).toBe("max_rounds");
	});
});

describe("DegradationMonitor.pushDraft()", () => {
	const config = {
		convergenceThreshold: 0.1,
		convergencePatience: 2,
		maxRounds: 10,
	};

	it("tracks distances and halts once drafts converge", () => {
		const monitor = new DegradationMonitor();
		expect(monitor.pushDraft("s", "draft one", config).shouldHalt).toBe(false);
		expect(monitor.pushDraft("s", "draft one", config).shouldHalt).toBe(false);
		const decision = monitor.pushDraft("s", "draft one", config);
		expect(decision.shouldHalt).toBe(true);
		expect(decision.reason).toBe("entropy");
	});

	it("clear resets the draft history", () => {
		const monitor = new DegradationMonitor();
		monitor.pushDraft("s", "draft one", config);
		monitor.clear("s");
		// After clearing, the first draft has no predecessor.
		expect(monitor.pushDraft("s", "draft one", config).shouldHalt).toBe(false);
	});
});
