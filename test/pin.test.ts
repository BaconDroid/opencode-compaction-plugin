import { describe, it, expect } from "bun:test";
import {
	isPinnedMessage,
	collectPinnedClauses,
	renderPinned,
	missingClauses,
} from "../src/core/pin.ts";

const msg = (text: string) => ({
	info: { role: "user" },
	parts: [{ type: "text", text }],
});

describe("isPinnedMessage()", () => {
	it("matches any pattern case-insensitively", () => {
		expect(isPinnedMessage(msg("NEVER force push"), ["never"])).toBe(true);
		expect(isPinnedMessage(msg("hello"), ["never"])).toBe(false);
		expect(isPinnedMessage(msg("hello"), [])).toBe(false);
		expect(isPinnedMessage(msg("   "), ["x"])).toBe(false);
	});
});

describe("collectPinnedClauses()", () => {
	it("collects matching lines, deduped and bounded", () => {
		const messages = [
			msg("line one\nNEVER force push\nline two"),
			msg("NEVER force push\nkeep tests green"),
		];
		const clauses = collectPinnedClauses(messages, ["never", "keep tests"], 10);
		expect(clauses).toEqual(["NEVER force push", "keep tests green"]);
		expect(collectPinnedClauses(messages, [], 10)).toEqual([]);
		expect(collectPinnedClauses(messages, ["never"], 1)).toEqual([
			"NEVER force push",
		]);
	});
});

describe("renderPinned() / missingClauses()", () => {
	it("renders bullets or undefined", () => {
		expect(renderPinned(["a", "b"])).toBe("- a\n- b");
		expect(renderPinned([])).toBeUndefined();
	});

	it("reports clauses missing from a summary", () => {
		expect(missingClauses("we keep tests green", ["keep tests green"])).toEqual(
			[],
		);
		expect(missingClauses("nothing here", ["NEVER force push"])).toEqual([
			"NEVER force push",
		]);
		expect(missingClauses("", [])).toEqual([]);
	});
});
