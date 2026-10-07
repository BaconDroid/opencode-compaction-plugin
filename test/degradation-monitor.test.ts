import { describe, it, expect } from "vitest";
import {
	messageHasText,
	countTrailingNoTextAssistant,
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
