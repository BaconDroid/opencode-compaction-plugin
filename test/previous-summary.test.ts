import { describe, it, expect } from "vitest";
import { extractPreviousSummary } from "../src/previous-summary.ts";

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
});
