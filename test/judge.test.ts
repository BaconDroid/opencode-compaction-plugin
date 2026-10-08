import { describe, it, expect, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTmpSetup, recordingLogger } from "./helpers.ts";
import {
	buildIntegrityPrompt,
	judgeClausesPreserved,
	parseVerdict,
} from "../src/core/judge.ts";
import { parseJudgeResponse, resolveJudge } from "../src/opencode/adapters.ts";
import { LiveCompactionPlugin } from "../src/index.ts";
import type { Judge } from "../src/core/adapters.ts";

describe("buildIntegrityPrompt()", () => {
	it("lists the clauses and the summary", () => {
		const prompt = buildIntegrityPrompt("the summary", ["clause a", "clause b"]);
		expect(prompt).toContain("- clause a");
		expect(prompt).toContain("- clause b");
		expect(prompt).toContain("the summary");
		expect(prompt).toContain("YES");
	});
});

describe("parseVerdict()", () => {
	it("parses yes/no case-insensitively and rejects ambiguity", () => {
		expect(parseVerdict("YES")).toBe(true);
		expect(parseVerdict("  yes.")).toBe(true);
		expect(parseVerdict("No")).toBe(false);
		expect(parseVerdict("NO, it does not")).toBe(false);
		expect(parseVerdict("maybe")).toBeUndefined();
		expect(parseVerdict("")).toBeUndefined();
		// A bare two-word hedge is not usable...
		expect(parseVerdict("yes and no")).toBeUndefined();
		// ...but a legitimate answer whose wording contains "no" still reads.
		expect(parseVerdict("YES, there is no issue")).toBe(true);
	});
});

describe("judgeClausesPreserved()", () => {
	it("returns true without asking when there are no clauses", async () => {
		let called = 0;
		const judge: Judge = { async ask() { called++; return "NO"; } };
		expect(await judgeClausesPreserved(judge, "s", [])).toBe(true);
		expect(called).toBe(0);
	});

	it("asks the judge and parses its verdict", async () => {
		const seen: string[] = [];
		const judge: Judge = {
			async ask(prompt) {
				seen.push(prompt);
				return "yes";
			},
		};
		expect(await judgeClausesPreserved(judge, "summary", ["c"])).toBe(true);
		expect(seen[0]).toContain("summary");
	});
});

describe("parseJudgeResponse()", () => {
	it("accepts the common provider shapes", () => {
		expect(parseJudgeResponse("plain")).toBe("plain");
		expect(parseJudgeResponse({ response: "ollama" })).toBe("ollama");
		expect(parseJudgeResponse({ content: "content" })).toBe("content");
		expect(
			parseJudgeResponse({ choices: [{ message: { content: "openai" } }] }),
		).toBe("openai");
		expect(parseJudgeResponse({ choices: [{ text: "legacy" }] })).toBe("legacy");
	});

	it("throws when no text is present", () => {
		expect(() => parseJudgeResponse({})).toThrow("no text");
	});
});

describe("resolveJudge()", () => {
	it("returns undefined when unset, disabled or missing a required field", () => {
		expect(resolveJudge(undefined, { logger: recordingLogger().logger })).toBeUndefined();
		expect(
			resolveJudge({ enabled: false, url: "u" }, { logger: recordingLogger().logger }),
		).toBeUndefined();
		expect(
			resolveJudge({ provider: "http" }, { logger: recordingLogger().logger }),
		).toBeUndefined();
		expect(
			resolveJudge({ provider: "command" }, { logger: recordingLogger().logger }),
		).toBeUndefined();
	});

	it("reports mcp as unsupported", () => {
		const { logger, messages } = recordingLogger();
		expect(resolveJudge({ provider: "mcp" }, { logger })).toBeUndefined();
		expect(messages.some((m) => m.includes("adapters.judge"))).toBe(true);
	});

	it("builds an http judge that parses an OpenAI response", async () => {
		let seenBody = "";
		const fetcher = (async (_url: unknown, init?: RequestInit) => {
			seenBody = String(init?.body);
			return {
				ok: true,
				status: 200,
				json: async () => ({ choices: [{ message: { content: "YES" } }] }),
			};
		}) as unknown as typeof fetch;
		const judge = resolveJudge(
			{ provider: "http", url: "http://localhost/judge", model: "m" },
			{ logger: recordingLogger().logger, fetcher },
		);
		expect(await judge!.ask("is it ok?")).toBe("YES");
		expect(seenBody).toContain('"model":"m"');
		expect(seenBody).toContain("is it ok?");
	});
});

describe("judge command provider", () => {
	const dir = mkdtempSync(join(tmpdir(), "lc-judge-"));
	const yesScript = join(dir, "yes.mjs");
	writeFileSync(
		yesScript,
		`let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{JSON.parse(d);process.stdout.write(JSON.stringify({response:"YES"}))});`,
	);
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("spawns the command and parses its JSON verdict", async () => {
		const judge = resolveJudge(
			{ provider: "command", command: `"${process.execPath}" "${yesScript}"` },
			{ logger: recordingLogger().logger },
		);
		expect(await judge!.ask("prompt")).toBe("YES");
	});

	it("sends the prompt as a messages payload", async () => {
		const echoScript = join(dir, "echo.mjs");
		writeFileSync(
			echoScript,
			`let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const {messages}=JSON.parse(d);process.stdout.write(messages[0].content)});`,
		);
		const judge = resolveJudge(
			{ provider: "command", command: `"${process.execPath}" "${echoScript}"` },
			{ logger: recordingLogger().logger },
		);
		expect(await judge!.ask("hello judge")).toBe("hello judge");
	});
});

describe("E6 integration: semantic constraint validation", () => {
	const dir = mkdtempSync(join(tmpdir(), "lc-judge-int-"));
	const yesScript = join(dir, "yes.mjs");
	const noScript = join(dir, "no.mjs");
	writeFileSync(
		yesScript,
		`let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{JSON.parse(d);process.stdout.write("YES")});`,
	);
	writeFileSync(
		noScript,
		`let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{JSON.parse(d);process.stdout.write("NO")});`,
	);
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const TMP_DIR = join(import.meta.dirname, "__tmp_judge_test");
	const { setup, cleanup } = makeTmpSetup(TMP_DIR);
	beforeEach(setup);
	afterEach(cleanup);

	const summaryMessages = {
		data: [
			{
				info: { role: "user" },
				parts: [{ type: "text", text: "NEVER force push to main" }],
			},
			{
				info: { role: "assistant", summary: true },
				parts: [
					{
						type: "text",
						text: "The user requested avoiding destructive git operations.",
					},
				],
			},
		],
	};

	async function run(script: string): Promise<string[]> {
		const logs: string[] = [];
		const ctx = {
			client: {
				app: {
					log: (input: { body: { message: string } }) => {
						logs.push(input.body.message);
						return Promise.resolve();
					},
				},
				session: { messages: async () => summaryMessages },
			},
			project: { id: "p", name: "p" },
			directory: TMP_DIR,
			worktree: TMP_DIR,
			serverUrl: new URL("http://localhost:4096"),
		};
		const hooks = await LiveCompactionPlugin(ctx as any, {
			debug: true,
			pinning: { patterns: ["never force push"] },
			adapters: {
				judge: {
					provider: "command",
					command: `"${process.execPath}" "${script}"`,
				},
			},
		} as any);
		// Populate the pinned clauses via a compaction pass.
		await hooks["experimental.session.compacting"]!(
			{ sessionID: "s1" },
			{ context: [] },
		);
		// Then run the post-compaction integrity check.
		await hooks.event!({
			event: {
				id: "e",
				type: "session.compacted",
				properties: { sessionID: "s1" },
			},
		});
		return logs;
	}

	it("accepts a paraphrase when the judge says YES", async () => {
		const logs = await run(yesScript);
		expect(logs).toContain("pinned constraints judged preserved");
		expect(logs).not.toContain("pinned constraints missing from summary");
	});

	it("warns when the judge says NO", async () => {
		const logs = await run(noScript);
		expect(logs).toContain("pinned constraints missing from summary");
	});
});
