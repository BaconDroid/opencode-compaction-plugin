import { describe, it, expect } from "bun:test";
import { buildTrimMap, trimToolOutput } from "../src/core/trim.ts";
import { mergeConfig } from "../src/config/config.ts";

describe("trimToolOutput()", () => {
	const map = { bash: 10, default: 5 };

	it("returns short output unchanged", () => {
		expect(trimToolOutput("bash", "short", map, 5)).toBe("short");
	});

	it("keeps the tail and appends a marker", () => {
		const out = trimToolOutput("bash", "x".repeat(100), map, 5);
		expect(out).toBe("x".repeat(10) + "\n... [trimmed 90/100 chars]");
	});

	it("does not re-trim an already trimmed output", () => {
		const once = trimToolOutput("bash", "x".repeat(100), map, 5);
		expect(trimToolOutput("bash", once, map, 5)).toBe(once);
	});

	it("does not re-trim deduped or bulk-evicted outputs", () => {
		const deduped = "[deduped: same call as later read output — 500 chars removed]";
		expect(trimToolOutput("delete", deduped, { delete: 50 }, 5)).toBe(deduped);
		const evicted = "tail\n... [evicted bulk output]";
		expect(trimToolOutput("delete", evicted, { delete: 50 }, 5)).toBe(evicted);
	});

	it("never enlarges an output", () => {
		// 30 chars with a limit of 10 would become 10 + 24 marker = 34 chars.
		const out = "x".repeat(30);
		expect(trimToolOutput("bash", out, map, 5)).toBe(out);
	});

	it("drops the whole output for a non-positive limit", () => {
		expect(trimToolOutput("bash", "content", { bash: 0 }, 5)).toBe(
			"\n... [trimmed 7/7 chars]",
		);
		expect(trimToolOutput("bash", "", { bash: 0 }, 5)).toBe("");
	});

	it("falls back to the default limit for unlisted tools", () => {
		expect(trimToolOutput("unknown", "a".repeat(100), {}, 4)).toBe(
			"aaaa\n... [trimmed 96/100 chars]",
		);
	});
});

describe("buildTrimMap()", () => {
	it("uses configured values and documented defaults", () => {
		const map = buildTrimMap(mergeConfig({ trim: { bash: 111 } }));
		expect(map.bash).toBe(111);
		expect(map.read).toBe(300);
		expect(map.delete).toBe(50);
	});
});
