import { describe, it, expect } from "bun:test";
import {
	totalInputTokens,
	effectiveInputTokens,
	resolveTriggerThreshold,
	shouldTriggerPreemptiveCompaction,
} from "../src/preemptive-compaction.ts";

describe("token helpers", () => {
	it("totalInputTokens sums input and cache reads", () => {
		expect(
			totalInputTokens({ input: 100, cache: { read: 50, write: 20 } }),
		).toBe(150);
		expect(totalInputTokens({})).toBe(0);
	});

	it("effectiveInputTokens excludes cache unless enabled", () => {
		const tokens = {
			input: 100,
			output: 10,
			reasoning: 5,
			cache: { read: 50, write: 20 },
		};
		expect(effectiveInputTokens(tokens, false)).toBe(115);
		expect(effectiveInputTokens(tokens, true)).toBe(185);
		expect(effectiveInputTokens({}, false)).toBe(0);
		expect(effectiveInputTokens({ cache: { read: 900 } }, false)).toBe(0);
		expect(effectiveInputTokens({ cache: { read: 900 } }, true)).toBe(900);
	});
});

describe("resolveTriggerThreshold()", () => {
	it("uses the ratio, or the smaller of ratio and absolute ceiling", () => {
		expect(resolveTriggerThreshold(1000, { threshold: 0.78 })).toBe(780);
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

	it("triggers at or above the threshold, or the absolute override", () => {
		expect(
			shouldTriggerPreemptiveCompaction({ ...base, totalInputTokens: 780 }),
		).toBe(true);
		expect(
			shouldTriggerPreemptiveCompaction({ ...base, totalInputTokens: 779 }),
		).toBe(false);
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

	it("does not trigger for an invalid limit, in progress, or within cooldown", () => {
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				contextLimit: 0,
				totalInputTokens: 900,
			}),
		).toBe(false);
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				inProgress: true,
			}),
		).toBe(false);
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

	it("applies the deterministic gates", () => {
		// token gate (unknown measurement is allowed)
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
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				minTokensSinceLast: 20_000,
			}),
		).toBe(true);
		// message gate
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
		// tail guard
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
		expect(
			shouldTriggerPreemptiveCompaction({
				...base,
				totalInputTokens: 900,
				tailGuard: { enabled: false, minNewToolCalls: 3 },
				newToolCallsSinceLast: 0,
			}),
		).toBe(true);
	});
});
