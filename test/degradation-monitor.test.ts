import { describe, it, expect } from "bun:test";
import {
	messageHasText,
	countTrailingNoTextAssistant,
	DegradationMonitor,
} from "../src/core/degradation-monitor.ts";

describe("messageHasText()", () => {
	it("detects non-empty text parts only", () => {
		expect(messageHasText([{ type: "text", text: "hi" }])).toBe(true);
		expect(messageHasText([{ type: "text", text: "   " }])).toBe(false);
		expect(messageHasText([{ type: "tool" }])).toBe(false);
		expect(messageHasText(undefined)).toBe(false);
	});
});

describe("countTrailingNoTextAssistant()", () => {
	it("counts trailing assistant messages without text", () => {
		expect(
			countTrailingNoTextAssistant([
				{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
				{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
			]),
		).toBe(2);
		expect(
			countTrailingNoTextAssistant([
				{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] },
			]),
		).toBe(0);
		expect(
			countTrailingNoTextAssistant([
				{ info: { role: "assistant" }, parts: [{ type: "tool" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "x" }] },
			]),
		).toBe(0);
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
