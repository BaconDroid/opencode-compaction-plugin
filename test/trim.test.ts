import { describe, it, expect } from "bun:test";
import { buildTrimMap, trimToolOutput } from "../src/core/trim.ts";
import { mergeConfig } from "../src/config/config.ts";

describe("trimToolOutput()", () => {
	const map = { bash: 10, default: 5 };

	it("returns short output unchanged", () => {
		expect(trimToolOutput("bash", "short", map, 5)).toBe("short");
	});

	it("keeps the tail and appends a marker", () => {
		const out = trimToolOutput("bash", "x".repeat(30), map, 5);
		expect(out).toBe("x".repeat(10) + "\n... [trimmed 20/30 chars]");
	});

	it("does not re-trim an already trimmed output", () => {
		const once = trimToolOutput("bash", "x".repeat(30), map, 5);
		expect(trimToolOutput("bash", once, map, 5)).toBe(once);
	});

	it("drops the whole output for a non-positive limit", () => {
		expect(trimToolOutput("bash", "content", { bash: 0 }, 5)).toBe(
			"\n... [trimmed 7/7 chars]",
		);
		expect(trimToolOutput("bash", "", { bash: 0 }, 5)).toBe("");
	});

	it("falls back to the default limit for unlisted tools", () => {
		expect(trimToolOutput("unknown", "abcdefghij", {}, 4)).toBe(
			"ghij\n... [trimmed 6/10 chars]",
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
