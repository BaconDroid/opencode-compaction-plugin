import { describe, it, expect } from "bun:test";
import {
	nthUserTurnFromEnd,
	getRecentTurnIndices,
	partInput,
	partsText,
} from "../src/core/messages.ts";

describe("nthUserTurnFromEnd()", () => {
	const msgs = [
		{ info: { role: "user" }, parts: [] },
		{ info: { role: "assistant" }, parts: [] },
		{ info: { role: "user" }, parts: [] },
	];

	it("returns the index of the Nth user turn from the end", () => {
		expect(nthUserTurnFromEnd(msgs as never, 1)).toBe(2);
		expect(nthUserTurnFromEnd(msgs as never, 2)).toBe(0);
		expect(nthUserTurnFromEnd(msgs as never, 3)).toBeUndefined();
		expect(nthUserTurnFromEnd(msgs as never, 0)).toBeUndefined();
	});

	it("skips malformed messages without info", () => {
		const withHole = [
			{ info: { role: "user" }, parts: [] },
			{} as never,
			{ info: { role: "user" }, parts: [] },
		];
		expect(nthUserTurnFromEnd(withHole as never, 1)).toBe(2);
		expect(nthUserTurnFromEnd(withHole as never, 2)).toBe(0);
	});
});

describe("getRecentTurnIndices()", () => {
	it("returns the trailing window and everything when short", () => {
		const msgs = [
			{ info: { role: "user" }, parts: [] },
			{ info: { role: "assistant" }, parts: [] },
			{ info: { role: "user" }, parts: [] },
		];
		expect([...getRecentTurnIndices(msgs as never, 1)]).toEqual([2]);
		expect([...getRecentTurnIndices(msgs as never, 5)]).toEqual([0, 1, 2]);
		expect([...getRecentTurnIndices(msgs as never, 0)]).toEqual([]);
	});
});

describe("partInput()", () => {
	it("prefers args over state.input", () => {
		expect(
			partInput({
				type: "tool",
				args: { a: 1 },
				state: { input: { b: 2 } },
			} as never),
		).toEqual({ a: 1 });
		expect(
			partInput({ type: "tool", state: { input: { b: 2 } } } as never),
		).toEqual({ b: 2 });
	});
});

describe("partsText()", () => {
	it("joins text parts and ignores non-text", () => {
		expect(
			partsText([
				{ type: "text", text: "a" },
				{ type: "tool", tool: "bash" },
				{ type: "text", text: "b" },
			]),
		).toBe("a\nb");
		expect(partsText("nope")).toBe("");
	});
});
