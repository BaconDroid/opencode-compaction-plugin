import { describe, it, expect } from "vitest";
import {
	totalInputTokens,
	effectiveInputTokens,
	resolveTriggerThreshold,
	shouldTriggerPreemptiveCompaction,
} from "../src/preemptive-compaction.ts";

describe("totalInputTokens()", () => {
	it("sums input and cache reads", () => {
		expect(
			totalInputTokens({ input: 100, cache: { read: 50, write: 20 } }),
		).toBe(150);
	});

	it("handles missing fields", () => {
		expect(totalInputTokens({})).toBe(0);
	});
});

describe("effectiveInputTokens()", () => {
	it("excludes cache tokens by default", () => {
		expect(
			effectiveInputTokens(
				{ input: 100, output: 10, reasoning: 5, cache: { read: 50, write: 20 } },
				false,
			),
		).toBe(115);
	});

	it("includes cache read and write when enabled", () => {
		expect(
			effectiveInputTokens(
				{ input: 100, output: 10, reasoning: 5, cache: { read: 50, write: 20 } },
				true,
			),
		).toBe(185);
	});

	it("handles missing fields", () => {
		expect(effectiveInputTokens({}, false)).toBe(0);
		expect(effectiveInputTokens({}, true)).toBe(0);
	});

	it("does not count a cache-only payload unless enabled", () => {
		expect(effectiveInputTokens({ cache: { read: 900 } }, false)).toBe(0);
		expect(effectiveInputTokens({ cache: { read: 900 } }, true)).toBe(900);
	});
});

describe("resolveTriggerThreshold()", () => {
	it("uses the ratio when no absolute ceiling is set", () => {
		expect(resolveTriggerThreshold(1000, { threshold: 0.78 })).toBe(780);
	});

	it("takes the smaller of the ratio and the absolute ceiling", () => {
		expect(
			resolveTriggerThreshold(1_000_000, {
				threshold: 0.78,
				absoluteTokenThreshold: 330_000,
			}),
		).toBe(330_000);
		expect(
			resolveTriggerThreshold(1000, {
				threshold: 0.78,
				absoluteTokenThreshold: 900,
			}),
		).toBe(780);
	});

	it("ignores a non-positive absolute ceiling", () => {
		expect(
			resolveTriggerThreshold(1000, {
				threshold: 0.5,
				absoluteTokenThreshold: 0,
			}),
		).toBe(500);
	});
});

describe("shouldTriggerPreemptiveCompaction()", () => {
	const base = {
		contextLimit: 1000,
		threshold: 0.78,
		cooldownMs: 60_000,
		now: 1_000_000,
		inProgress: false,
	};

	it("triggers at or above the threshold", () => {
		expect(
			shouldTriggerPreemptiveCompaction({ ...base, totalInputTokens: 780 }),
		).toBe(true);
		expect(
			shouldTriggerPreemptiveCompaction({ ...base, totalInputTokens: 779 }),
		).toBe(false);
	});

	it("does not trigger while in progress", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				inProgress: true,
			}),
		).toBe(false);
	});

	it("respects the cooldown", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				lastCompactionAt: base.now - 1000,
			}),
		).toBe(false);
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				lastCompactionAt: base.now - 61_000,
			}),
		).toBe(true);
	});

	it("honors an absolute thresholdTokens override", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 300,
				thresholdTokens: 300,
			}),
		).toBe(true);
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 299,
				thresholdTokens: 300,
			}),
		).toBe(false);
	});

	it("blocks when fewer new tokens than minTokensSinceLast", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				minTokensSinceLast: 20_000,
				tokensSinceLast: 5_000,
			}),
		).toBe(false);
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				minTokensSinceLast: 20_000,
				tokensSinceLast: 25_000,
			}),
		).toBe(true);
	});

	it("allows an unknown tokensSinceLast through the token gate", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				minTokensSinceLast: 20_000,
			}),
		).toBe(true);
	});

	it("blocks when fewer new messages than minMessagesSinceLast", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				minMessagesSinceLast: 6,
				messagesSinceLast: 3,
			}),
		).toBe(false);
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				minMessagesSinceLast: 6,
				messagesSinceLast: 6,
			}),
		).toBe(true);
	});

	it("blocks under the tail guard until enough new tool calls", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				tailGuard: { enabled: true, minNewToolCalls: 3 },
				newToolCallsSinceLast: 1,
			}),
		).toBe(false);
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				tailGuard: { enabled: true, minNewToolCalls: 3 },
				newToolCallsSinceLast: 3,
			}),
		).toBe(true);
	});

	it("ignores the tail guard when disabled", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				tailGuard: { enabled: false, minNewToolCalls: 3 },
				newToolCallsSinceLast: 0,
			}),
		).toBe(true);
	});

	it("does not trigger for an invalid limit", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				contextLimit: 0,
				totalInputTokens: 900,
			}),
		).toBe(false);
	});
});
