import { describe, it, expect } from "vitest";
import {
	buildCompactionPrompt,
	extractLatestUserAsk,
} from "../src/prompt.ts";

describe("buildCompactionPrompt()", () => {
	it("returns a non-empty string", () => {
		const prompt = buildCompactionPrompt({});
		expect(typeof prompt).toBe("string");
		expect(prompt.length).toBeGreaterThan(100);
	});

	it("contains all 11 sections in the template", () => {
		const prompt = buildCompactionPrompt({});
		const sections = [
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
		];
		for (const section of sections) {
			expect(prompt).toContain(section);
		}
	});

	it("includes the <template> block", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("<template>");
		expect(prompt).toContain("</template>");
	});

	it("includes rules section", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("Rules:");
		expect(prompt).toContain("(none)");
	});

	it("documents the status markers", () => {
		const prompt = buildCompactionPrompt({});
		for (const marker of [
			"[DONE]",
			"[IN PROGRESS]",
			"[TODO]",
			"[BLOCKED]",
			"[FAILED]",
			"[UNVERIFIED]",
		]) {
			expect(prompt).toContain(marker);
		}
	});

	it("generalizes the (none) placeholder across sections", () => {
		const prompt = buildCompactionPrompt({});
		// Every optional section now documents the empty placeholder.
		for (const section of [
			"## User Intent Trail",
			"## Task Continuity",
			"## Next Steps",
		]) {
			const idx = prompt.indexOf(section);
			const next = prompt.indexOf("##", idx + section.length);
			const body = prompt.slice(idx, next === -1 ? undefined : next);
			expect(body).toContain("(none)");
		}
	});

	it("does NOT include files block when no filesTouched", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).not.toContain("## Files Touched");
	});

	it("includes files block when filesTouched is provided", () => {
		const prompt = buildCompactionPrompt({
			filesTouched: "## Files Touched Manifest\n\n- `src/app.ts` `R` `E`",
		});
		expect(prompt).toContain("## Files Touched Manifest");
		expect(prompt).toContain("- `src/app.ts` `R` `E`");
	});

	it("includes previous-summary instructions", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("<previous-summary>");
	});

	it("includes the previous summary block when provided", () => {
		const prompt = buildCompactionPrompt({ previousSummary: "old summary" });
		expect(prompt).toContain("<previous-summary>");
		expect(prompt).toContain("old summary");
	});

	it("mentions anchored summary behavior", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("anchored summary");
	});

	it("preserves constraints verbatim and subagent task ids", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("verbatim");
		expect(prompt).toContain("task_id");
	});

	it("injects the task-state block when provided", () => {
		const prompt = buildCompactionPrompt({
			taskState: "- [~] write tests (id=t1, status=in_progress)",
		});
		expect(prompt).toContain("<task-state>");
		expect(prompt).toContain("</task-state>");
		expect(prompt).toContain("- [~] write tests");
	});

	it("injects the latest-user-ask block when focus is provided", () => {
		const prompt = buildCompactionPrompt({ focus: "fix the login bug" });
		expect(prompt).toContain("<latest-user-ask>");
		expect(prompt).toContain("fix the login bug");
	});

	it("omits the latest-user-ask block when absent", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).not.toContain("<latest-user-ask>\n");
	});

	it("omits the task-state block when absent", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("If the prompt includes a <task-state> block");
		expect(prompt).not.toContain("<task-state>\n");
	});

	it("combines files and previous summary together", () => {
		const prompt = buildCompactionPrompt({
			filesTouched: "## Files Touched Manifest\n\n- `config.json` `W`",
			previousSummary: "prior",
		});
		expect(prompt).toContain("## Files Touched Manifest");
		expect(prompt).toContain("<previous-summary>");
		expect(prompt).toContain("prior");
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

	it("ignores empty user messages and non-arrays", () => {
		expect(extractLatestUserAsk(undefined)).toBeUndefined();
		expect(
			extractLatestUserAsk([
				{ info: { role: "user" }, parts: [{ type: "text", text: "  " }] },
			]),
		).toBeUndefined();
	});

	it("truncates to maxLen", () => {
		const long = "x".repeat(1000);
		const result = extractLatestUserAsk(
			[{ info: { role: "user" }, parts: [{ type: "text", text: long }] }],
			100,
		);
		expect(result).toBe(`${"x".repeat(100)}…`);
	});
});
