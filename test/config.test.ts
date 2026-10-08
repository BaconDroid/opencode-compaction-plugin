import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/config/config-loader.ts";
import { mergeConfig, DEFAULT_CONFIG } from "../src/config/config.ts";
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
		});
		expect(cfg.eviction).toMatchObject({
			enabled: true,
			thresholdTokens: 200000,
			protectPrologue: true,
		});
		expect(cfg.eviction.levels).toEqual([
			"reasoning",
			"bulk_output",
			"intermediate",
			"episode",
		]);
		expect(cfg.adapters).toBeUndefined();
	});

	it("keeps defaults when an override value is undefined", () => {
		const cfg = mergeConfig({ dedup: { enabled: undefined } });
		expect(cfg.dedup.enabled).toBe(true);
	});

	it("returns an independent copy of the defaults", () => {
		const a = mergeConfig({});
		a.dedup.protectedTools.push("x");
		a.eviction.levels.push("episode");
		expect(mergeConfig({}).dedup.protectedTools).toEqual([]);
		expect(mergeConfig({}).eviction.levels).toHaveLength(4);
	});

	it("normalizes destructive or malformed values", () => {
		const cfg = mergeConfig({
			eviction: { thresholdTokens: -5, levels: ["bogus", "episode"] },
			purgeErrors: { turns: -1 },
		} as any);
		expect(cfg.eviction.thresholdTokens).toBe(
			DEFAULT_CONFIG.eviction.thresholdTokens,
		);
		expect(cfg.eviction.levels).toEqual(["episode"]);
		expect(cfg.purgeErrors.turns).toBe(DEFAULT_CONFIG.purgeErrors.turns);
	});

	it("drops invalid adapter numerics", () => {
		const cfg = mergeConfig({
			adapters: {
				scorer: {
					provider: "command",
					command: "c",
					maxSamples: 0,
					timeoutMs: -5,
				},
			},
		} as any);
		expect(cfg.adapters?.scorer?.maxSamples).toBeUndefined();
		expect(cfg.adapters?.scorer?.timeoutMs).toBeUndefined();
	});

	it("tolerates malformed non-object sections", () => {
		const cfg = mergeConfig({
			dedup: null,
			compress: false,
			eviction: false,
		} as any);
		expect(cfg.dedup.enabled).toBe(true);
		expect(cfg.compress.protectedTurns).toBe(3);
		expect(cfg.eviction.levels).toHaveLength(4);
	});

	it("rejects non-boolean and non-numeric strategy values", () => {
		const cfg = mergeConfig({
			enabled: "yes",
			debug: 1,
			promptMode: "weird",
			dedup: { enabled: "nope" },
			purgeErrors: { cascade: "true", wholeAttempt: 0, turns: 3.9 },
			compress: { reversible: "no", protectedTurns: -2 },
			eviction: { enabled: "y", protectPrologue: null },
		} as any);
		expect(cfg.enabled).toBe(true);
		expect(cfg.debug).toBe(false);
		expect(cfg.promptMode).toBe("replace");
		expect(cfg.dedup.enabled).toBe(true);
		expect(cfg.purgeErrors.cascade).toBe(true);
		expect(cfg.purgeErrors.wholeAttempt).toBe(true);
		expect(cfg.purgeErrors.turns).toBe(3);
		expect(cfg.compress.reversible).toBe(false);
		expect(cfg.compress.protectedTurns).toBe(3);
		expect(cfg.eviction.enabled).toBe(true);
		expect(cfg.eviction.protectPrologue).toBe(true);
	});

	it("drops a non-boolean adapter enabled flag", () => {
		const cfg = mergeConfig({
			adapters: { scorer: { provider: "http", url: "u", enabled: "yes" } },
		} as any);
		expect(cfg.adapters?.scorer?.enabled).toBeUndefined();
	});

	it("preserves an explicit empty eviction.levels", () => {
		const cfg = mergeConfig({ eviction: { levels: [] } });
		expect(cfg.eviction.levels).toEqual([]);
	});

	it("falls back to all levels when every level is unknown", () => {
		const cfg = mergeConfig({ eviction: { levels: ["bogus"] } } as any);
		expect(cfg.eviction.levels).toEqual([
			"reasoning",
			"bulk_output",
			"intermediate",
			"episode",
		]);
	});

	it("coerces non-array list config to empty and drops non-strings", () => {
		const cfg = mergeConfig({
			dedup: { protectedTools: "bash" },
		} as any);
		expect(cfg.dedup.protectedTools).toEqual([]);
	});

	it("overrides top-level and strategy settings", () => {
		const cfg = mergeConfig({
			enabled: false,
			debug: true,
			promptMode: "augment",
			dedup: { enabled: false, protectedTools: ["bash"] },
			purgeErrors: { enabled: false, turns: 8, wholeAttempt: true, cascade: false },
		});
		expect(cfg.enabled).toBe(false);
		expect(cfg.debug).toBe(true);
		expect(cfg.promptMode).toBe("augment");
		expect(cfg.dedup).toEqual({ enabled: false, protectedTools: ["bash"] });
		expect(cfg.purgeErrors).toMatchObject({
			enabled: false,
			turns: 8,
			wholeAttempt: true,
			cascade: false,
		});
	});

	it("leaves adapters off by default and preserves configured blocks", () => {
		expect(mergeConfig({}).adapters).toBeUndefined();
		const cfg = mergeConfig({
			adapters: {
				scorer: { provider: "http", url: "http://s", maxSamples: 10 },
			},
		});
		expect(cfg.adapters?.scorer).toMatchObject({
			url: "http://s",
			maxSamples: 10,
		});
	});

	it("preserves the opencode provider on the scorer", () => {
		const cfg = mergeConfig({
			adapters: {
				scorer: { provider: "opencode", model: "host" },
			},
		} as any);
		expect(cfg.adapters?.scorer).toMatchObject({
			provider: "opencode",
			model: "host",
		});
	});

	it("overrides compress and eviction settings", () => {
		const cfg = mergeConfig({
			compress: { protectedTurns: 5, reversible: false },
			eviction: { enabled: true, thresholdTokens: 1000, levels: ["episode"] },
		});
		expect(cfg.compress).toEqual({
			protectedTurns: 5,
			reversible: false,
		});
		expect(cfg.eviction).toMatchObject({
			enabled: true,
			thresholdTokens: 1000,
			levels: ["episode"],
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

	it("tolerates a comment between a trailing comma and the closing brace", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.jsonc"),
			`{
				"enabled": false,
				"purgeErrors": { "turns": 10 },
				// comment before the closing brace
			}`,
		);
		const cfg = loadConfig(TMP_DIR);
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
				adapters: { scorer: { provider: "http", url: "http://x" } },
			}),
		);
		expect(loadConfig(TMP_DIR).adapters?.scorer?.url).toBe("http://x");
	});

	it("applies precedence: defaults < global < plugin options < project", () => {
		mkdirSync(join(TMP_DIR, "xdg", "opencode"), { recursive: true });
		writeFileSync(
			join(TMP_DIR, "xdg", "opencode", "live-compaction.json"),
			JSON.stringify({ purgeErrors: { turns: 11 } }),
		);
		expect(loadConfig(TMP_DIR).purgeErrors.turns).toBe(11);
		expect(
			loadConfig(TMP_DIR, undefined, { purgeErrors: { turns: 77 } }).purgeErrors
				.turns,
		).toBe(77);
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			JSON.stringify({ purgeErrors: { turns: 99 } }),
		);
		const cfg = loadConfig(TMP_DIR, undefined, { purgeErrors: { turns: 77 } });
		expect(cfg.purgeErrors.turns).toBe(99);
	});
});
