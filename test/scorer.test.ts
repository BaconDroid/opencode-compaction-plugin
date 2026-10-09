import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SCORER_CONCURRENCY,
	buildScorerEstimator,
} from "../src/core/scorer.ts";
import { applyEviction, estimateTokens } from "../src/core/eviction.ts";
import { applyTransform } from "../src/core/transform.ts";
import { mergeConfig } from "../src/config/config.ts";
import { CompressionStore } from "../src/core/compress.ts";
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
	});

	it("keeps a cached current text when trimming the cache", async () => {
		const scorer: Scorer = {
			async score(text) {
				return text.length;
			},
		};
		// Fill the cache to its bound (1000), then re-score an old text together
		// with a new one: trimming must not evict the cached current text.
		const fill = Array.from({ length: 1000 }, (_, i) => `t${i}`);
		await buildScorerEstimator(
			scorer,
			fill.map((t) => textMsg("assistant", t)) as any,
			1005,
		);
		const estimate = await buildScorerEstimator(
			scorer,
			[textMsg("assistant", "t0"), textMsg("assistant", "t1000")] as any,
			1005,
		);
		// t0 = 2 (cached), t1000 = 5; with the bug t0 falls back to ceil(2/4)=1.
		expect(
			estimate([
				textMsg("assistant", "t0"),
				textMsg("assistant", "t1000"),
			] as any),
		).toBe(7);
	});

	it("caches scores across transforms for the same scorer", async () => {
		let calls = 0;
		const scorer: Scorer = {
			async score() {
				calls++;
				return 1;
			},
		};
		const messages = [
			textMsg("assistant", "alpha"),
			textMsg("assistant", "beta"),
		];
		await buildScorerEstimator(scorer, messages as any);
		expect(calls).toBe(2);
		await buildScorerEstimator(scorer, messages as any);
		expect(calls).toBe(2);
	});

	it("ignores whitespace-only text parts", async () => {
		let calls = 0;
		const scorer: Scorer = {
			async score() {
				calls++;
				return 1;
			},
		};
		const messages = [
			textMsg("assistant", "   "),
			textMsg("assistant", "real"),
		];
		await buildScorerEstimator(scorer, messages as any);
		expect(calls).toBe(1);
	});

	it("bounds the number of in-flight scorer requests", async () => {
		let inFlight = 0;
		let max = 0;
		const scorer: Scorer = {
			async score() {
				inFlight++;
				max = Math.max(max, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 1));
				inFlight--;
				return 1;
			},
		};
		const messages = Array.from({ length: 50 }, (_, i) =>
			textMsg("assistant", `t${i}`),
		);
		await buildScorerEstimator(scorer, messages as any);
		expect(max).toBeLessThanOrEqual(SCORER_CONCURRENCY);
	});

	it("rejects when a score fails (the caller falls back)", async () => {
		const messages = [textMsg("assistant", "a"), textMsg("assistant", "b")];
		const scorer: Scorer = {
			async score(text) {
				if (text === "b") throw new Error("boom");
				return 1;
			},
		};
		await expect(
			buildScorerEstimator(scorer, messages as any),
		).rejects.toThrow("boom");
	});

	it("prefers a batched scoreMany over repeated score calls", async () => {
		let calls = 0;
		const batches: string[][] = [];
		const scorer: Scorer = {
			async score() {
				throw new Error("score should not be called");
			},
			async scoreMany(texts) {
				calls++;
				batches.push(texts);
				return texts.map((text) => text.length);
			},
		};
		const messages = [
			textMsg("assistant", "alpha"),
			textMsg("assistant", "beta"),
		];
		const estimate = await buildScorerEstimator(scorer, messages as any);
		expect(calls).toBe(1);
		expect(batches[0]).toEqual(["alpha", "beta"]);
		expect(estimate(messages as any)).toBe(9);
	});

	it("rejects when scoreMany returns the wrong count", async () => {
		const scorer: Scorer = {
			async score() {
				return 1;
			},
			async scoreMany() {
				return [1];
			},
		};
		const messages = [textMsg("assistant", "a"), textMsg("assistant", "b")];
		await expect(
			buildScorerEstimator(scorer, messages as any),
		).rejects.toThrow("scores for");
	});
});

describe("applyEviction() with a text resolver", () => {
	it("triggers on the resolver result instead of the heuristic", () => {
		const messages = [
			{ info: { role: "assistant" }, parts: [{ type: "reasoning", text: "x" }] },
		] as any;
		// Heuristic is tiny (1 token) but the resolver says 999.
		const result = applyEviction(messages, {
			enabled: true,
			thresholdTokens: 50,
			levels: ["reasoning"],
			protectPrologue: false,
			resolveText: () => 999,
		});
		expect(result.removed).toBe(1);
		expect(messages[0].parts[0].text).toBe("[evicted reasoning]");
	});

	it("skips eviction when the resolver is below budget", () => {
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
			resolveText: () => 10,
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
		// Empty/whitespace is not a score (Number("") is 0).
		expect(() => parseScore("")).toThrow("no numeric score");
		expect(() => parseScore("   ")).toThrow("no numeric score");
		expect(() => parseScore({ score: "  " })).toThrow("no numeric score");
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

describe("scorer budget gate (transform)", () => {
	const config = mergeConfig({
		dedup: { enabled: false },
		purgeErrors: { enabled: false },
		eviction: {
			enabled: true,
			thresholdTokens: 1000,
			levels: ["reasoning"],
			protectPrologue: false,
		},
	});
	const makeDeps = () => ({
		config,
		logger: recordingLogger().logger,
		compressions: new CompressionStore(),
	});

	it("skips the scorer when the context is far below the budget", async () => {
		let calls = 0;
		const scorer: Scorer = {
			async score() {
				calls++;
				return 999;
			},
		};
		const messages = [
			{
				info: { role: "assistant" },
				parts: [{ type: "reasoning", text: "x".repeat(40) }],
			},
		];
		await applyTransform(messages as any, { ...makeDeps(), scorer });
		expect(calls).toBe(0);
	});

	it("consults the scorer near the budget", async () => {
		let calls = 0;
		const scorer: Scorer = {
			async score() {
				calls++;
				return 999;
			},
		};
		const messages = [
			{
				info: { role: "assistant" },
				parts: [{ type: "reasoning", text: "x".repeat(4000) }],
			},
		];
		await applyTransform(messages as any, { ...makeDeps(), scorer });
		expect(calls).toBeGreaterThan(0);
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

describe("resolveScorer() with the opencode provider", () => {
	it("warms the model scorer cache in the background (non-blocking)", async () => {
		let calls = 0;
		const modelRunner = async (prompt: string): Promise<string> => {
			calls++;
			const texts = JSON.parse(prompt.slice(prompt.lastIndexOf("[")));
			return JSON.stringify(texts.map(() => 10));
		};
		const scorer = resolveScorer(
			{ provider: "opencode" },
			{ logger: recordingLogger().logger, modelRunner },
		);
		expect(scorer).toBeDefined();
		// The first call returns nothing yet (heuristic) and schedules a fill.
		const first = await scorer!.scoreMany!(["a", "b"]);
		expect(first.every((value) => Number.isNaN(value))).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toBe(1);
		// The warmed cache is used on the next call.
		expect(await scorer!.scoreMany!(["a", "b"])).toEqual([10, 10]);
		expect(await scorer!.score("a")).toBe(10);
	});

	it("disables the opencode scorer without a runner", () => {
		const { logger, messages } = recordingLogger();
		expect(resolveScorer({ provider: "opencode" }, { logger })).toBeUndefined();
		expect(messages.some((m) => m.includes("requires an SDK client"))).toBe(true);
	});
});
