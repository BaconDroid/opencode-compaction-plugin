import { describe, it, expect } from "bun:test";
import { matchesGlob, extractFilePaths, isFileProtected } from "../src/core/glob.ts";

describe("matchesGlob()", () => {
	it("matches the expected patterns", () => {
		const cases: Array<[string, string, boolean]> = [
			["src/a.ts", "", false],
			["AGENTS.md", "AGENTS.md", true],
			["README.md", "AGENTS.md", false],
			["src/app.ts", "src/*.ts", true],
			["src/nested/app.ts", "src/*.ts", false],
			["src/nested/app.ts", "src/**/*.ts", true],
			["deep/nested/dir/app.ts", "**/*.ts", true],
			["src/a.ts", "src/?.ts", true],
			["src/ab.ts", "src/?.ts", false],
			["src/app.config.ts", "**/*.config.ts", true],
			[".opencode/live-compaction.json", ".opencode/live-compaction.json", true],
			["src\\app.ts", "src/*.ts", true],
			["file.ts", "file.ts", true],
			["file_ts", "file.ts", false],
			["src/(app)/file.ts", "src/(app)/*.ts", true],
			["anything/at/all.ts", "**.ts", true],
			["foobarbaz", "**bar**", true],
			["src/app.test.ts", "**/*.test.*", true],
		];
		for (const [file, pattern, expected] of cases) {
			expect(matchesGlob(file, pattern), `${file} ~ ${pattern}`).toBe(expected);
		}
	});
});

describe("extractFilePaths()", () => {
	it("extracts, deduplicates and ignores empty paths", () => {
		expect(extractFilePaths("read", { filePath: "src/a.ts" })).toEqual(["src/a.ts"]);
		expect(extractFilePaths("read", { path: "src/b.ts" })).toEqual(["src/b.ts"]);
		expect(extractFilePaths("read", { file: "src/c.ts" })).toEqual(["src/c.ts"]);
		expect(
			extractFilePaths("read", { filePath: "src/a.ts", path: "src/a.ts" }),
		).toEqual(["src/a.ts"]);
		expect(extractFilePaths("bash", { command: "ls" })).toEqual([]);
		expect(extractFilePaths("read", { filePath: "" })).toEqual([]);
	});

	it("extracts from a multi-edit edits array", () => {
		const paths = extractFilePaths("multiedit", {
			filePath: "main.ts",
			edits: [{ filePath: "a.ts" }, { filePath: "b.ts" }],
		});
		expect(paths).toEqual(expect.arrayContaining(["main.ts", "a.ts", "b.ts"]));
	});
});

describe("isFileProtected()", () => {
	it("checks paths against patterns", () => {
		const cases: Array<[string[], string[], boolean]> = [
			[["src/a.ts"], [], false],
			[[], ["*.ts"], false],
			[["AGENTS.md"], ["AGENTS.md"], true],
			[["src/app.config.ts"], ["**/*.config.ts"], true],
			[["src/app.ts"], ["*.config.ts"], false],
			[["src/a.ts", "AGENTS.md"], ["AGENTS.md"], true],
			[["src/app.ts"], ["AGENTS.md", "**/*.ts"], true],
		];
		for (const [paths, patterns, expected] of cases) {
			expect(isFileProtected(paths, patterns)).toBe(expected);
		}
	});
});
