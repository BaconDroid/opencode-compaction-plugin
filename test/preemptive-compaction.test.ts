import { describe, it, expect } from "vitest";
import {
	totalInputTokens,
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
