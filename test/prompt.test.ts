import { describe, it, expect } from "bun:test";
import { buildCompactionPrompt, extractLatestUserAsk } from "../src/prompt.ts";

describe("buildCompactionPrompt()", () => {
	it("contains the 11-section template, rules and status markers", () => {
		const prompt = buildCompactionPrompt({});
		expect(typeof prompt).toBe("string");
		expect(prompt.length).toBeGreaterThan(100);
		for (const section of [
			"## Brief",
			"## User Intent Trail",
			"## Constraints & Preferences",
			"## Errors & Dead Ends",
			"## Key Decisions",
			"## Status",
			"### Done",
			"### In Progress",
			"### Blocked",
			"## Task Continuity",
			"## Open Issues & Questions",
			"## Next Steps",
			"## Mandatory Reading",
			"<template>",
			"</template>",
			"Rules:",
			"(none)",
		]) {
			expect(prompt, section).toContain(section);
		}
		for (const marker of [
			"[DONE]",
			"[IN PROGRESS]",
			"[TODO]",
			"[BLOCKED]",
			"[FAILED]",
			"[UNVERIFIED]",
		]) {
			expect(prompt, marker).toContain(marker);
		}
	});

	it("generalizes the (none) placeholder across optional sections", () => {
		const prompt = buildCompactionPrompt({});
		for (const section of [
			"## User Intent Trail",
			"## Task Continuity",
			"## Next Steps",
		]) {
			const idx = prompt.indexOf(section);
			const next = prompt.indexOf("##", idx + section.length);
			const body = prompt.slice(idx, next === -1 ? undefined : next);
			expect(body, section).toContain("(none)");
		}
	});

	it("mentions anchored summary and verbatim constraints / task ids", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("anchored summary");
		expect(prompt).toContain("verbatim");
		expect(prompt).toContain("task_id");
	});

	it("injects the optional blocks only when provided", () => {
		const bare = buildCompactionPrompt({});
		expect(bare).not.toContain("## Files Touched");
		expect(bare).not.toContain("<task-state>\n");
		expect(bare).not.toContain("<latest-user-ask>\n");

		const full = buildCompactionPrompt({
			filesTouched: "## Files Touched Manifest\n\n- `src/app.ts` `R` `E`",
			previousSummary: "prior summary",
			taskState: "- [~] write tests (id=t1, status=in_progress)",
			focus: "fix the login bug",
		});
		expect(full).toContain("## Files Touched Manifest");
		expect(full).toContain("- `src/app.ts` `R` `E`");
		expect(full).toContain("<previous-summary>");
		expect(full).toContain("prior summary");
		expect(full).toContain("<task-state>");
		expect(full).toContain("- [~] write tests");
		expect(full).toContain("<latest-user-ask>");
		expect(full).toContain("fix the login bug");
	});
});

describe("extractLatestUserAsk()", () => {
	it("returns the most recent user text", () => {
		const messages = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "first" }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
			{ info: { role: "user" }, parts: [{ type: "text", text: "second" }] },
		];
		expect(extractLatestUserAsk(messages)).toBe("second");
	});

	it("ignores empty messages and non-arrays", () => {
		expect(extractLatestUserAsk(undefined)).toBeUndefined();
		expect(
			extractLatestUserAsk([
				{ info: { role: "user" }, parts: [{ type: "text", text: "  " }] },
			]),
		).toBeUndefined();
	});

	it("truncates to maxLen", () => {
		const result = extractLatestUserAsk(
			[{ info: { role: "user" }, parts: [{ type: "text", text: "x".repeat(1000) }] }],
			100,
		);
		expect(result).toBe(`${"x".repeat(100)}…`);
	});
});
