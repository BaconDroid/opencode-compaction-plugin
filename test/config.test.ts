import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/config/config-loader.ts";
import {
	mergeConfig,
	DEFAULT_CONFIG,
	DEFAULT_TRIM,
} from "../src/config/config.ts";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeTmpSetup } from "./helpers.ts";

const TMP_DIR = join(import.meta.dirname, "__tmp_config_test");
const { setup: setupTmp, cleanup: cleanupTmp } = makeTmpSetup(TMP_DIR);

describe("mergeConfig()", () => {
	it("returns the documented defaults", () => {
		const cfg = mergeConfig({});
		expect(cfg.enabled).toBe(true);
		expect(cfg.debug).toBe(false);
		expect(cfg.promptMode).toBe("replace");
		expect(cfg.trim.bash).toBe(600);
		expect(cfg.dedup).toEqual({ enabled: true, protectedTools: [] });
		expect(cfg.purgeErrors).toMatchObject({
			enabled: true,
			turns: 4,
			wholeAttempt: true,
			cascade: true,
		});
		expect(cfg.compress).toEqual({
			protectedTurns: 3,
			reversible: false,
			maxBlocksPerSquash: 8,
			searchMaxResults: 5,
		});
		expect(cfg.eviction).toMatchObject({
			enabled: true,
			thresholdTokens: 80000,
			protectPrologue: true,
		});
		expect(cfg.eviction.levels).toEqual([
			"reasoning",
			"bulk_output",
			"intermediate",
			"episode",
		]);
		expect(cfg.pinning).toEqual({
			enabled: true,
			patterns: [],
			maxClauses: 20,
		});
		expect(cfg.preemptiveCompaction).toMatchObject({
			enabled: false,
			threshold: 0.78,
			countCacheTokens: true,
			minTokensSinceLast: 0,
			minMessagesSinceLast: 0,
			cooldownMs: 60000,
		});
		expect(cfg.preemptiveCompaction.absoluteTokenThreshold).toBeUndefined();
		expect(cfg.preemptiveCompaction.tailGuard).toEqual({
			enabled: false,
			minNewToolCalls: 3,
		});
		expect(cfg.degradationMonitor).toMatchObject({
			enabled: false,
			threshold: 4,
			windowMs: 120000,
		});
	});

	it("overrides top-level and strategy settings", () => {
		const cfg = mergeConfig({
			enabled: false,
			debug: true,
			promptMode: "augment",
			trim: { bash: 1000, read: 500 },
			dedup: { enabled: false, protectedTools: ["bash"] },
			purgeErrors: { enabled: false, turns: 8, wholeAttempt: true, cascade: true },
		});
		expect(cfg.enabled).toBe(false);
		expect(cfg.debug).toBe(true);
		expect(cfg.promptMode).toBe("augment");
		expect(cfg.trim.bash).toBe(1000);
		expect(cfg.trim.read).toBe(500);
		expect(cfg.trim.write).toBe(100); // untouched default
		expect(cfg.dedup).toEqual({ enabled: false, protectedTools: ["bash"] });
		expect(cfg.purgeErrors).toMatchObject({
			enabled: false,
			turns: 8,
			wholeAttempt: true,
			cascade: true,
		});
	});

	it("leaves adapters off by default and preserves configured blocks", () => {
		expect(mergeConfig({}).adapters).toBeUndefined();
		const cfg = mergeConfig({
			adapters: {
				embeddings: { provider: "http", url: "http://e", minScore: 0.3 },
				judge: { provider: "command", command: "judge-cmd" },
				scorer: { provider: "http", url: "http://s", maxSamples: 10 },
			},
		});
		expect(cfg.adapters?.embeddings).toMatchObject({
			url: "http://e",
			minScore: 0.3,
		});
		expect(cfg.adapters?.judge?.command).toBe("judge-cmd");
		expect(cfg.adapters?.scorer).toMatchObject({
			url: "http://s",
			maxSamples: 10,
		});
	});

	it("overrides compress, eviction, preemptive and degradation settings", () => {
		const cfg = mergeConfig({
			compress: { protectedTurns: 5, reversible: false, maxBlocksPerSquash: 2 },
			eviction: { enabled: true, thresholdTokens: 1000, levels: ["episode"] },
			preemptiveCompaction: {
				enabled: true,
				contextLimit: 1234,
				absoluteTokenThreshold: 330000,
				countCacheTokens: true,
				minTokensSinceLast: 20000,
				minMessagesSinceLast: 6,
				tailGuard: { enabled: true, minNewToolCalls: 5 },
			},
			degradationMonitor: { enabled: true, threshold: 2, windowMs: 60000 },
		});
		expect(cfg.compress).toEqual({
			protectedTurns: 5,
			reversible: false,
			maxBlocksPerSquash: 2,
			searchMaxResults: 5,
		});
		expect(cfg.eviction).toMatchObject({
			enabled: true,
			thresholdTokens: 1000,
			levels: ["episode"],
		});
		expect(cfg.preemptiveCompaction).toMatchObject({
			enabled: true,
			contextLimit: 1234,
			absoluteTokenThreshold: 330000,
			countCacheTokens: true,
			minTokensSinceLast: 20000,
			minMessagesSinceLast: 6,
			tailGuard: { enabled: true, minNewToolCalls: 5 },
		});
		expect(cfg.degradationMonitor).toMatchObject({
			enabled: true,
			threshold: 2,
			windowMs: 60000,
		});
	});
});

describe("loadConfig()", () => {
	beforeEach(setupTmp);
	afterEach(cleanupTmp);

	it("returns defaults when no config file exists", () => {
		const cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(true);
		expect(cfg.dedup.enabled).toBe(true);
	});

	it("loads json/jsonc, prefers .json and tolerates comments and trailing commas", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			JSON.stringify({ enabled: false, dedup: { enabled: false } }),
		);
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.jsonc"),
			'{ "debug": true }',
		);
		let cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(false);
		expect(cfg.dedup.enabled).toBe(false);
		expect(cfg.debug).toBe(false); // .json preferred over .jsonc

		rmSync(join(TMP_DIR, ".opencode", "live-compaction.json"));
		cfg = loadConfig(TMP_DIR);
		expect(cfg.debug).toBe(true); // falls back to .jsonc

		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.jsonc"),
			`{
				// line comment
				"enabled": false,
				/* block comment */
				"purgeErrors": { "turns": 10 },
			}`,
		);
		cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(false);
		expect(cfg.purgeErrors.turns).toBe(10);
	});

	it("preserves slashes and escapes inside JSONC strings", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.jsonc"),
			`{
				"debug": true,
				"url": "https://example.com/a//b",
				"note": "he said \\"hi\\"",
			}`,
		);
		const cfg = loadConfig(TMP_DIR) as unknown as {
			debug: boolean;
			url?: string;
			note?: string;
		};
		expect(cfg.debug).toBe(true);
		expect(cfg.url).toBe("https://example.com/a//b");
		expect(cfg.note).toBe('he said "hi"');
	});

	it("falls back to defaults on invalid JSON and reports the error", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			"not valid json {{{",
		);
		const errors: string[] = [];
		const cfg = loadConfig(TMP_DIR, (message) => errors.push(message));
		expect(cfg.enabled).toBe(true);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("failed to parse");
	});

	it("loads adapter blocks from a project file", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			JSON.stringify({
				adapters: { embeddings: { provider: "http", url: "http://x" } },
			}),
		);
		expect(loadConfig(TMP_DIR).adapters?.embeddings?.url).toBe("http://x");
	});

	it("applies precedence: defaults < global < plugin options < project", () => {
		mkdirSync(join(TMP_DIR, "xdg", "opencode"), { recursive: true });
		writeFileSync(
			join(TMP_DIR, "xdg", "opencode", "live-compaction.json"),
			JSON.stringify({ trim: { bash: 111, read: 222 } }),
		);
		expect(loadConfig(TMP_DIR).trim.bash).toBe(111);
		expect(
			loadConfig(TMP_DIR, undefined, { trim: { bash: 777 } }).trim.bash,
		).toBe(777);
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			JSON.stringify({ trim: { bash: 999 } }),
		);
		const cfg = loadConfig(TMP_DIR, undefined, { trim: { bash: 777 } });
		expect(cfg.trim.bash).toBe(999);
		expect(cfg.trim.read).toBe(222);
	});
});

describe("DEFAULT_CONFIG", () => {
	it("exposes the expected fields and trim tools", () => {
		for (const key of ["enabled", "debug", "trim", "dedup", "purgeErrors"]) {
			expect(DEFAULT_CONFIG).toHaveProperty(key);
		}
		for (const tool of [
			"bash",
			"write",
			"edit",
			"delete",
			"read",
			"glob",
			"grep",
			"list",
			"default",
		]) {
			expect(DEFAULT_TRIM).toHaveProperty(tool);
		}
	});
});
