import { describe, it, expect } from "bun:test";
import {
	PreemptionController,
	effectiveInputTokens,
	resolveTriggerThreshold,
	shouldTriggerPreemptiveCompaction,
} from "../src/core/preemption.ts";
import { mergeConfig } from "../src/config/config.ts";

function makeController(
	over: Record<string, unknown> = {},
	clientOver: Record<string, unknown> = {},
): PreemptionController {
	const config = mergeConfig({
		preemptiveCompaction: { enabled: true, cooldownMs: 0, ...over },
	});
	const client = {
		app: { log: async () => {} },
		session: { summarize: async () => {} },
		provider: {
			list: async () => ({
				data: {
					all: [
						{ id: "prov", models: { "model-x": { limit: { context: 1000 } } } },
					],
				},
			}),
		},
		...clientOver,
	};
	const logger = { info: () => {}, warn: () => {} };
	return new PreemptionController(client as never, "/tmp", config, logger);
}

describe("token helpers", () => {
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

describe("PreemptionController", () => {
	it("summarizes once for overlapping calls", async () => {
		let calls = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const controller = makeController(
			{},
			{
				session: {
					summarize: async () => {
						calls++;
						await gate;
					},
				},
			},
		);
		controller.recordUsage("s", "prov", "model-x", { input: 900 });

		const first = controller.maybePreempt("s");
		const second = controller.maybePreempt("s");
		release();
		await Promise.all([first, second]);
		expect(calls).toBe(1);
	});

	it("measures new tokens from the post-compaction baseline", async () => {
		let calls = 0;
		const controller = makeController(
			{ contextLimit: 1000, minTokensSinceLast: 500 },
			{
				session: {
					summarize: async () => {
						calls++;
					},
				},
			},
		);
		controller.recordUsage("s", "prov", "model-x", { input: 900 });
		await controller.maybePreempt("s");
		expect(calls).toBe(1);

		// Post-compaction usage report sets the baseline to 100.
		controller.recordUsage("s", "prov", "model-x", { input: 100 });
		// 800 total = 700 new (>= 500) and 80% (>= 78%): triggers again.
		controller.recordUsage("s", "prov", "model-x", { input: 800 });
		await controller.maybePreempt("s");
		expect(calls).toBe(2);
	});

	it("caches a negative context-limit lookup", async () => {
		let listCalls = 0;
		const controller = makeController(
			{},
			{
				provider: {
					list: async () => {
						listCalls++;
						return { data: { all: [] } };
					},
				},
			},
		);
		controller.recordUsage("s", "prov", "unknown-model", { input: 900 });
		await controller.maybePreempt("s");
		await controller.maybePreempt("s");
		await controller.isCompressEligible("s");
		expect(listCalls).toBe(1);
	});

	it("does not commit gate/cooldown state when summarize fails", async () => {
		let calls = 0;
		let fail = true;
		const controller = makeController(
			{ contextLimit: 1000, cooldownMs: 60_000 },
			{
				session: {
					summarize: async () => {
						calls++;
						if (fail) throw new Error("boom");
					},
				},
			},
		);
		controller.recordUsage("s", "prov", "model-x", { input: 900 });
		await controller.maybePreempt("s");
		expect(calls).toBe(1);
		// The failure must not set the cooldown, so a retry is allowed.
		fail = false;
		await controller.maybePreempt("s");
		expect(calls).toBe(2);
	});

	it("re-checks a negative lookup after its TTL", async () => {
		let listCalls = 0;
		const controller = makeController(
			{},
			{
				provider: {
					list: async () => {
						listCalls++;
						return { data: { all: [] } };
					},
				},
			},
		);
		controller.recordUsage("s", "prov", "model-x", { input: 900 });
		await controller.maybePreempt("s");
		await controller.maybePreempt("s");
		expect(listCalls).toBe(1);

		const realNow = Date.now;
		Date.now = () => realNow() + 61_000;
		try {
			await controller.maybePreempt("s");
		} finally {
			Date.now = realNow;
		}
		expect(listCalls).toBe(2);
	});
});
