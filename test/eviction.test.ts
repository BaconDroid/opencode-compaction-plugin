import { describe, it, expect } from "bun:test";
import {
	applyEviction,
	estimateTokens,
	type EvictionConfig,
} from "../src/core/eviction.ts";

const cfg = (over: Partial<EvictionConfig> = {}): EvictionConfig => ({
	enabled: true,
	thresholdTokens: 1,
	...over,
});

function assistantWithReasoning(text: string) {
	return {
		info: { role: "assistant" },
		parts: [{ type: "reasoning", text }],
	};
}

function assistantWithText(text: string) {
	return { info: { role: "assistant" }, parts: [{ type: "text", text }] };
}

function assistantWithTool(output: string, callID = "c1") {
	return {
		info: { role: "assistant" },
		parts: [{ type: "tool", tool: "bash", callID, state: { output } }],
	};
}

function userMsg(text: string) {
	return { info: { role: "user" }, parts: [{ type: "text", text }] };
}

describe("estimateTokens()", () => {
	it("estimates from text and tool output", () => {
		const messages = [assistantWithText("x".repeat(400))] as any;
		expect(estimateTokens(messages)).toBe(100);
	});

	it("includes tool outputs and inputs", () => {
		const messages = [assistantWithTool("y".repeat(400))] as any;
		expect(estimateTokens(messages)).toBe(100);
	});
});

describe("applyEviction()", () => {
	it("is a no-op when disabled", () => {
		const messages = [assistantWithReasoning("x".repeat(4000))] as any;
		const result = applyEviction(messages, cfg({ enabled: false }));
		expect(result.removed).toBe(0);
		expect(messages[0].parts[0].text).toBe("x".repeat(4000));
	});

	it("is a no-op below the budget", () => {
		const messages = [assistantWithReasoning("x".repeat(40))] as any;
		const result = applyEviction(messages, cfg({ thresholdTokens: 1000 }));
		expect(result.removed).toBe(0);
	});

	it("never evicts user turns", () => {
		const messages = [
			userMsg("x".repeat(4000)),
			userMsg("y".repeat(4000)),
		] as any;
		const result = applyEviction(messages, cfg({ thresholdTokens: 1 }));
		expect(result.removed).toBe(0);
		expect(messages[0].parts[0].text).toBe("x".repeat(4000));
		expect(messages[1].parts[0].text).toBe("y".repeat(4000));
	});

	it("protects the prologue by default", () => {
		const messages = [
			assistantWithReasoning("x".repeat(4000)),
			assistantWithReasoning("y".repeat(4000)),
		] as any;
		applyEviction(messages, cfg({ thresholdTokens: 1, levels: ["reasoning"] }));
		// First message protected; second evicted.
		expect(messages[0].parts[0].text).toBe("x".repeat(4000));
		expect(messages[1].parts[0].text).toBe("[evicted reasoning]");
	});

	it("can evict the prologue when protection is disabled", () => {
		const messages = [assistantWithReasoning("x".repeat(4000))] as any;
		applyEviction(
			messages,
			cfg({ thresholdTokens: 1, levels: ["reasoning"], protectPrologue: false }),
		);
		expect(messages[0].parts[0].text).toBe("[evicted reasoning]");
	});

	it("applies levels in order and stops at the budget", () => {
		const messages = [
			userMsg("p"),
			assistantWithReasoning("r".repeat(4000)),
			assistantWithTool("t".repeat(4000)),
		] as any;
		// Enough budget for reasoning only.
		applyEviction(messages, cfg({ thresholdTokens: 1200 }));
		expect(messages[1].parts[0].text).toBe("[evicted reasoning]");
		// Bulk output untouched because the budget was reached.
		expect((messages[2].parts[0] as any).state.output).toBe("t".repeat(4000));
	});

	it("evicts bulk output when reasoning is not enough", () => {
		const messages = [
			userMsg("p"),
			assistantWithTool("t".repeat(4000)),
		] as any;
		applyEviction(
			messages,
			cfg({ thresholdTokens: 1, levels: ["bulk_output"] }),
		);
		const output = (messages[1].parts[0] as any).state.output as string;
		expect(output).toContain("[evicted bulk output]");
		expect(output.length).toBeLessThan(400);
	});

	it("evicts intermediate text but keeps the last assistant message", () => {
		const messages = [
			userMsg("p"),
			assistantWithText("a".repeat(4000)),
			assistantWithText("b".repeat(4000)),
		] as any;
		applyEviction(messages, cfg({ thresholdTokens: 1, levels: ["intermediate"] }));
		expect(messages[1].parts[0].text).toBe("[evicted intermediate]");
		// The last assistant message is preserved.
		expect(messages[2].parts[0].text).toBe("b".repeat(4000));
	});

	it("never evicts protected message indices", () => {
		const messages = [
			userMsg("p"),
			assistantWithTool("t".repeat(4000)),
		] as any;
		const result = applyEviction(
			messages,
			cfg({ thresholdTokens: 1, protectedIndices: new Set([1]) }),
		);
		expect(result.removed).toBe(0);
		expect((messages[1].parts[0] as any).state.output).toBe("t".repeat(4000));
	});

	it("evicts whole episodes and records ids", () => {
		const messages = [
			userMsg("p"),
			assistantWithTool("t".repeat(4000), "call-1"),
		] as any;
		const result = applyEviction(
			messages,
			cfg({ thresholdTokens: 1, levels: ["episode"] }),
		);
		expect(result.removed).toBe(1);
		expect(result.evictedIds).toContain("r:call-1");
		expect(messages[1].parts[0].text).toBe("[evicted episode]");
	});

	it("is idempotent across passes (reasoning, bulk, intermediate)", () => {
		const reasoning = [
			userMsg("p"),
			assistantWithReasoning("x".repeat(4000)),
		] as any;
		const reasoningCfg = cfg({ thresholdTokens: 1, levels: ["reasoning"] });
		expect(applyEviction(reasoning, reasoningCfg).removed).toBe(1);
		expect(applyEviction(reasoning, reasoningCfg).removed).toBe(0);

		const bulk = [userMsg("p"), assistantWithTool("y".repeat(4000))] as any;
		const bulkCfg = cfg({ thresholdTokens: 1, levels: ["bulk_output"] });
		expect(applyEviction(bulk, bulkCfg).removed).toBe(1);
		const afterFirst = (bulk[1].parts[0] as any).state.output as string;
		expect(applyEviction(bulk, bulkCfg).removed).toBe(0);
		expect((bulk[1].parts[0] as any).state.output).toBe(afterFirst);

		const intermediate = [
			userMsg("p"),
			assistantWithText("a".repeat(4000)),
			assistantWithText("last"),
		] as any;
		const intermediateCfg = cfg({
			thresholdTokens: 1,
			levels: ["intermediate"],
		});
		expect(applyEviction(intermediate, intermediateCfg).removed).toBe(1);
		expect(applyEviction(intermediate, intermediateCfg).removed).toBe(0);
	});
});

describe("applyEviction() exact running total", () => {
	// The O(n) path (running char/token totals) must be byte-for-byte equivalent
	// to the old re-estimating path (opaque `estimate`), with and without a scorer
	// resolver. Compare pass0 (legacy) vs pass1 (exact) over many inputs.
	const scenarios = (): any[] => [
		[
			userMsg("p"),
			assistantWithReasoning("r".repeat(4000)),
			assistantWithText("m".repeat(4000)),
			assistantWithTool("t".repeat(4000), "c1"),
		],
		[
			assistantWithReasoning("a".repeat(123)),
			assistantWithTool("b".repeat(5000), "c2"),
			assistantWithText("c".repeat(1500)),
			assistantWithText("d".repeat(50)),
		],
	];
	const thresholds = [1, 50, 300, 900, 1200, 5000, 100000];
	const levelSets: Array<any> = [
		["reasoning", "bulk_output", "intermediate", "episode"],
		["bulk_output", "episode"],
		["intermediate"],
	];

	it("matches the re-estimating path without a scorer", () => {
		for (const messages of scenarios()) {
			for (const thresholdTokens of thresholds) {
				for (const levels of levelSets) {
					const base = { enabled: true, thresholdTokens, levels };
					const legacyMsgs = structuredClone(messages);
					const exactMsgs = structuredClone(messages);
					const legacy = applyEviction(legacyMsgs, {
						...base,
						estimate: estimateTokens,
					});
					const exact = applyEviction(exactMsgs, { ...base });
					expect(exact.removed).toBe(legacy.removed);
					expect(exact.evictedIds).toEqual(legacy.evictedIds);
					expect(JSON.stringify(exactMsgs)).toBe(JSON.stringify(legacyMsgs));
				}
			}
		}
	});

	it("matches the re-estimating path with a scorer resolver", () => {
		const scores = new Map<string, number>([
			["r".repeat(4000), 500],
			["m".repeat(4000), 12],
			["[evicted reasoning]", 3],
			["[evicted intermediate]", 4],
		]);
		const resolveText = (text: string) => scores.get(text);
		const blackbox = (msgs: any[]) => estimateTokens(msgs, resolveText);
		for (const messages of scenarios()) {
			for (const thresholdTokens of thresholds) {
				for (const levels of levelSets) {
					const legacyMsgs = structuredClone(messages);
					const exactMsgs = structuredClone(messages);
					const legacy = applyEviction(legacyMsgs, {
						enabled: true,
						thresholdTokens,
						levels,
						estimate: blackbox,
					});
					const exact = applyEviction(exactMsgs, {
						enabled: true,
						thresholdTokens,
						levels,
						resolveText,
					});
					expect(exact.removed).toBe(legacy.removed);
					expect(exact.evictedIds).toEqual(legacy.evictedIds);
					expect(JSON.stringify(exactMsgs)).toBe(JSON.stringify(legacyMsgs));
				}
			}
		}
	});
});
