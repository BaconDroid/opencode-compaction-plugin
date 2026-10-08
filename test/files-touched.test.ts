import { describe, it, expect } from "bun:test";
import { FilesTouchedTracker } from "../src/core/files-touched.ts";

describe("FilesTouchedTracker", () => {
	it("starts empty", () => {
		const tracker = new FilesTouchedTracker();
		expect(tracker.size).toBe(0);
		expect(tracker.renderManifest()).toBe("");
	});

	it("records operations, deduplicates and normalizes paths", () => {
		const tracker = new FilesTouchedTracker();
		tracker.record("src/index.ts", "R");
		expect(tracker.size).toBe(1);
		tracker.record("./src/index.ts", "E"); // ./ prefix
		tracker.record("src//index.ts", "W"); // // collapse
		expect(tracker.size).toBe(1);
		const manifest = tracker.renderManifest();
		expect(manifest).toContain("`R`");
		expect(manifest).toContain("`E`");
		expect(manifest).toContain("`W`");
	});

	it("ignores empty paths and tracks distinct files", () => {
		const tracker = new FilesTouchedTracker();
		tracker.record("", "R");
		tracker.record("./", "R");
		expect(tracker.size).toBe(0);
		tracker.record("src/a.ts", "R");
		tracker.record("src/b.ts", "W");
		tracker.record("src/c.ts", "E");
		expect(tracker.size).toBe(3);
	});

	it("maps tool calls to operations", () => {
		const cases: Array<[string, Record<string, unknown>, string]> = [
			["read", { filePath: "src/main.ts" }, "`R`"],
			["file_read", { path: "src/other.ts" }, "`R`"],
			["write", { filePath: "src/new.ts" }, "`W`"],
			["edit", { filePath: "src/existing.ts" }, "`E`"],
			["delete", { filePath: "src/old.ts" }, "`D`"],
			["patch", { filePath: "src/patched.ts" }, "`E`"],
			["multiedit", { filePath: "src/multi.ts" }, "`E`"],
		];
		for (const [tool, args, badge] of cases) {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall(tool, args);
			expect(tracker.renderManifest(), tool).toContain(badge);
		}
	});

	it("extracts paths from bash and git commands", () => {
		const tracker = new FilesTouchedTracker();
		tracker.processToolCall("bash", { command: "cat src/config.json" });
		tracker.processToolCall("bash", { command: "git add src/staged.ts" });
		const manifest = tracker.renderManifest();
		expect(manifest).toContain("src/config.json");
		expect(manifest).toContain("src/staged.ts");
	});

	it("maps shell verbs to operations", () => {
		const tracker = new FilesTouchedTracker();
		tracker.processToolCall("bash", { command: "rm src/old.ts" });
		tracker.processToolCall("bash", { command: "mv src/a.ts src/b.ts" });
		tracker.processToolCall("bash", { command: "cp src/a.ts src/copy.ts" });
		const manifest = tracker.renderManifest();
		expect(manifest).toContain("- `src/old.ts` `D`");
		expect(manifest).toContain("- `src/a.ts` `M` `W`");
		expect(manifest).toContain("- `src/b.ts` `M`");
		expect(manifest).toContain("- `src/copy.ts` `W`");
	});

	it("does not treat command substrings as commands", () => {
		const tracker = new FilesTouchedTracker();
		tracker.processToolCall("bash", {
			command: "copycat secret.txt && confirm deploy.txt",
		});
		expect(tracker.size).toBe(0);
	});

	it("ignores unknown tools and malformed args", () => {
		const tracker = new FilesTouchedTracker();
		tracker.processToolCall("unknown_tool", { path: "src/a.ts" });
		tracker.processToolCall("read", {} as Record<string, unknown>);
		tracker.processToolCall("read", { filePath: 123 });
		expect(tracker.size).toBe(0);
	});

	it("renders a sorted manifest with a legend and badges", () => {
		const tracker = new FilesTouchedTracker();
		tracker.record("src/z.ts", "R");
		tracker.record("src/a.ts", "R");
		tracker.record("src/a.ts", "W");
		tracker.record("src/m.ts", "R");
		const manifest = tracker.renderManifest();
		expect(manifest).toContain("## Files Touched Manifest");
		expect(manifest).toContain("`R`=read");
		expect(manifest).toContain("- `src/a.ts` `R` `W`");
		expect(manifest.indexOf("src/a.ts")).toBeLessThan(
			manifest.indexOf("src/m.ts"),
		);
		expect(manifest.indexOf("src/m.ts")).toBeLessThan(
			manifest.indexOf("src/z.ts"),
		);
	});

	it("clears the tracker", () => {
		const tracker = new FilesTouchedTracker();
		tracker.record("src/a.ts", "R");
		tracker.record("src/b.ts", "W");
		expect(tracker.size).toBe(2);
		tracker.clear();
		expect(tracker.size).toBe(0);
		expect(tracker.renderManifest()).toBe("");
	});
});
