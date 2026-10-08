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
	it("estimates text, tool outputs and tool inputs", () => {
		expect(
			estimateTokens([assistantWithText("x".repeat(400))] as any),
		).toBe(100);
		const withIO = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { output: "y".repeat(200), input: "z".repeat(200) },
					},
				],
			},
		] as any;
		expect(estimateTokens(withIO)).toBe(100);
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
