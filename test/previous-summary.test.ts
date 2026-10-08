import { describe, it, expect } from "bun:test";
import {
	extractPreviousSummary,
	type SlidingState,
} from "../src/core/previous-summary.ts";

describe("extractPreviousSummary()", () => {
	it("returns the last assistant summary text", () => {
		const messages = [
			{
				info: { role: "assistant", summary: true },
				parts: [{ type: "text", text: "old" }],
			},
			{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
			{
				info: { role: "assistant", summary: true },
				parts: [{ type: "text", text: "new" }],
			},
		];
		expect(extractPreviousSummary(messages)).toBe("new");
	});

	it("ignores non-summary assistant messages", () => {
		const messages = [
			{
				info: { role: "assistant" },
				parts: [{ type: "text", text: "not a summary" }],
			},
		];
		expect(extractPreviousSummary(messages)).toBeUndefined();
	});

	it("joins multiple text parts", () => {
		const messages = [
			{
				info: { role: "assistant", summary: true },
				parts: [
					{ type: "text", text: "a" },
					{ type: "text", text: "b" },
				],
			},
		];
		expect(extractPreviousSummary(messages)).toBe("a\nb");
	});

	it("returns undefined for non-arrays or empty summaries", () => {
		expect(extractPreviousSummary(undefined)).toBeUndefined();
		expect(
			extractPreviousSummary([
				{ info: { role: "assistant", summary: true }, parts: [] },
			]),
		).toBeUndefined();
	});

	it("records the carried summary in the sliding state", () => {
		const state: SlidingState = {};
		const messages = [
			{
				info: { role: "assistant", summary: true, id: "s1" },
				parts: [{ type: "text", text: "first" }],
			},
		];
		expect(extractPreviousSummary(messages, state)).toBe("first");
		expect(state.lastSummaryMessageId).toBe("s1");
		expect(state.lastSummaryText).toBe("first");
	});

	it("falls back to the carried text when the summary is not re-emitted", () => {
		const state: SlidingState = {
			lastSummaryMessageId: "s1",
			lastSummaryText: "carried",
		};
		const messages = [
			{
				info: { role: "assistant", summary: true, id: "s1" },
				parts: [{ type: "text", text: "first" }],
			},
		];
		// The matching message is skipped, so it falls back to the carried text
		// (a re-emit would return "first" and fail).
		expect(extractPreviousSummary(messages, state)).toBe("carried");
		// No summary message at all: same fallback.
		expect(
			extractPreviousSummary(
				[{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] }],
				{ lastSummaryText: "carried" },
			),
		).toBe("carried");
	});

	it("prefers a newer summary over the carried one", () => {
		const state: SlidingState = {
			lastSummaryMessageId: "s1",
			lastSummaryText: "first",
		};
		const messages = [
			{
				info: { role: "assistant", summary: true, id: "s1" },
				parts: [{ type: "text", text: "first" }],
			},
			{
				info: { role: "assistant", summary: true, id: "s2" },
				parts: [{ type: "text", text: "second" }],
			},
		];
		expect(extractPreviousSummary(messages, state)).toBe("second");
		expect(state.lastSummaryMessageId).toBe("s2");
	});

});
