import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_SCORER_MAX_SAMPLES,
	buildScorerEstimator,
} from "../src/core/scorer.ts";
import { applyEviction, estimateTokens } from "../src/core/eviction.ts";
import { parseScore, resolveScorer } from "../src/opencode/adapters.ts";
import { LiveCompactionPlugin } from "../src/index.ts";
import { makeTmpSetup, recordingLogger } from "./helpers.ts";
import type { Scorer } from "../src/core/adapters.ts";

function textMsg(role: string, text: string, type = "text") {
	return { info: { role }, parts: [{ type, text }] };
}

function toolMsg(output: string) {
	return {
		info: { role: "assistant" },
		parts: [{ type: "tool", tool: "bash", state: { output } }],
	};
}

describe("buildScorerEstimator()", () => {
	it("substitutes scored text for the heuristic, keeps outputs heuristic", async () => {
		const text = "x".repeat(400); // heuristic: 100
		const messages = [textMsg("assistant", text), toolMsg("y".repeat(400))];
		const scorer: Scorer = { async score() { return 5; } };
		const estimate = await buildScorerEstimator(scorer, messages as any);
		// 5 (scored text) + 100 (tool output heuristic).
		expect(estimate(messages as any)).toBe(105);
	});

	it("falls back to estimateTokens with no text parts", async () => {
		const messages = [toolMsg("y".repeat(400))];
		const scorer: Scorer = { async score() { return 1; } };
		const estimate = await buildScorerEstimator(scorer, messages as any);
		expect(estimate(messages as any)).toBe(estimateTokens(messages as any));
	});

	it("falls back when every score is unusable", async () => {
		const messages = [textMsg("assistant", "x".repeat(400))];
		const scorer: Scorer = { async score() { return Number.NaN; } };
		const estimate = await buildScorerEstimator(scorer, messages as any);
		expect(estimate(messages as any)).toBe(100);
	});

	it("scores each distinct text once and honours maxSamples", async () => {
		const seen: string[] = [];
		const scorer: Scorer = {
			async score(text) {
				seen.push(text);
				return 10;
			},
		};
		const messages = [
			textMsg("assistant", "alpha"),
			textMsg("assistant", "alpha"),
			textMsg("assistant", "beta"),
		];
		const estimate = await buildScorerEstimator(scorer, messages as any, 1);
		// Only "alpha" is scored (maxSamples=1); its score applies to both
		// occurrences, "beta" (3 chars → 1) keeps the heuristic.
		expect(seen).toEqual(["alpha"]);
		expect(estimate(messages as any)).toBe(21);
		expect(DEFAULT_SCORER_MAX_SAMPLES).toBe(200);
	});
});

describe("applyEviction() with a custom estimator", () => {
	it("triggers on the estimator result instead of the heuristic", () => {
		const messages = [
			{ info: { role: "assistant" }, parts: [{ type: "reasoning", text: "x" }] },
		] as any;
		// Heuristic is tiny (1 token) but the estimator says 999.
		const estimate = () => 999;
		const result = applyEviction(messages, {
			enabled: true,
			thresholdTokens: 50,
			levels: ["reasoning"],
			protectPrologue: false,
			estimate,
		});
		expect(result.removed).toBe(1);
		expect(messages[0].parts[0].text).toBe("[evicted reasoning]");
	});

	it("skips eviction when the estimator is below budget", () => {
		const messages = [
			{
				info: { role: "assistant" },
				parts: [{ type: "reasoning", text: "x".repeat(4000) }],
			},
		] as any;
		const result = applyEviction(messages, {
			enabled: true,
			thresholdTokens: 50,
			levels: ["reasoning"],
			protectPrologue: false,
			estimate: () => 10,
		});
		expect(result.removed).toBe(0);
	});
});

describe("parseScore()", () => {
	it("accepts numbers, numeric strings and common object shapes", () => {
		expect(parseScore(42)).toBe(42);
		expect(parseScore("17")).toBe(17);
		expect(parseScore({ score: 3 })).toBe(3);
		expect(parseScore({ value: "4" })).toBe(4);
		expect(parseScore({ data: [{ score: 9 }] })).toBe(9);
	});

	it("throws when no numeric score is present", () => {
		expect(() => parseScore({})).toThrow("no numeric score");
		expect(() => parseScore("abc")).toThrow("no numeric score");
	});
});

describe("resolveScorer()", () => {
	it("returns undefined when unset, disabled or missing a required field", () => {
		expect(resolveScorer(undefined, { logger: recordingLogger().logger })).toBeUndefined();
		expect(
			resolveScorer({ enabled: false, url: "u" }, { logger: recordingLogger().logger }),
		).toBeUndefined();
		expect(
			resolveScorer({ provider: "http" }, { logger: recordingLogger().logger }),
		).toBeUndefined();
		expect(
			resolveScorer({ provider: "command" }, { logger: recordingLogger().logger }),
		).toBeUndefined();
	});

	it("builds an http scorer that parses a score response", async () => {
		let seenBody = "";
		const fetcher = (async (_url: unknown, init?: RequestInit) => {
			seenBody = String(init?.body);
			return { ok: true, status: 200, json: async () => ({ score: 12 }) };
		}) as unknown as typeof fetch;
		const scorer = resolveScorer(
			{ provider: "http", url: "http://localhost/score", model: "m" },
			{ logger: recordingLogger().logger, fetcher },
		);
		expect(await scorer!.score("hello")).toBe(12);
		expect(seenBody).toContain('"text":"hello"');
	});
});

describe("scorer command provider & transform integration", () => {
	const dir = mkdtempSync(join(tmpdir(), "lc-scorer-"));
	const highScript = join(dir, "high.mjs");
	const failScript = join(dir, "fail.mjs");
	writeFileSync(
		highScript,
		`let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{JSON.parse(d);process.stdout.write(JSON.stringify({score:999}))});`,
	);
	writeFileSync(failScript, "process.exit(2);");
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("spawns the command and parses a numeric score", async () => {
		const scorer = resolveScorer(
			{ provider: "command", command: `"${process.execPath}" "${highScript}"` },
			{ logger: recordingLogger().logger },
		);
		expect(await scorer!.score("x")).toBe(999);
	});

	const TMP_DIR = join(import.meta.dirname, "__tmp_scorer_test");
	const { setup, cleanup } = makeTmpSetup(TMP_DIR);
	beforeEach(setup);
	afterEach(cleanup);

	async function runTransform(script: string) {
		const logs: string[] = [];
		const ctx = {
			client: { app: { log: (input: { body: { message: string } }) => { logs.push(input.body.message); return Promise.resolve(); } } },
			project: { id: "p", name: "p" },
			directory: TMP_DIR,
			worktree: TMP_DIR,
			serverUrl: new URL("http://localhost:4096"),
		};
		const hooks = await LiveCompactionPlugin(ctx as any, {
			debug: true,
			eviction: { enabled: true, thresholdTokens: 50, levels: ["reasoning"], protectPrologue: false },
			adapters: {
				scorer: { provider: "command", command: `"${process.execPath}" "${script}"` },
			},
		} as any);
		const messages = [
			{ info: { role: "assistant" }, parts: [{ type: "reasoning", text: "x".repeat(100) }] },
		];
		await hooks["experimental.chat.messages.transform"]!({} as any, { messages } as any);
		return { logs, messages };
	}

	it("uses the scorer estimate to trigger eviction", async () => {
		const { logs, messages } = await runTransform(highScript);
		expect(logs).toContain("eviction applied");
		expect((messages[0].parts[0] as any).text).toBe("[evicted reasoning]");
	});

	it("falls back to the heuristic when the scorer errors", async () => {
		const { logs, messages } = await runTransform(failScript);
		expect(logs).toContain("scorer adapter failed; using heuristic estimate");
		// Heuristic (~25 tokens) is below the 50 budget → untouched.
		expect((messages[0].parts[0] as any).text).toBe("x".repeat(100));
	});
});
