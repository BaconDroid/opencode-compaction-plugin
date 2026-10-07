import { describe, it, expect } from "bun:test";
import {
	blockId,
	isCompressedBlockMessage,
	collectExistingBlockIds,
	parseCompressBlocks,
	orderCompressBlocks,
	renderBlockBody,
	selectDeterministicSpan,
	type BlockMessage,
} from "../src/blocks.ts";

function textMsg(role: string, text: string, extra: Record<string, unknown> = {}) {
	return { info: { role, ...extra }, parts: [{ type: "text", text }] };
}

function toolMsg(callID: string, extra: Record<string, unknown> = {}) {
	return {
		info: { role: "assistant", ...extra },
		parts: [{ type: "tool", tool: "bash", callID, state: { output: "ok" } }],
	};
}

describe("blockId()", () => {
	it("uses r:<callID> for tool parts", () => {
		expect(blockId(toolMsg("call-1") as BlockMessage)).toBe("r:call-1");
	});

	it("uses u:<timestamp> for user turns", () => {
		expect(
			blockId(textMsg("user", "hi", { timestamp: 42 }) as BlockMessage),
		).toBe("u:42");
	});

	it("uses a:<id> for other messages and is stable", () => {
		const msg = textMsg("assistant", "hi", { id: "resp-1" }) as BlockMessage;
		expect(blockId(msg)).toBe("a:resp-1");
		expect(blockId(msg)).toBe(blockId(msg));
	});
});

describe("compressed block detection", () => {
	it("detects the <compressed-block> tag", () => {
		expect(
			isCompressedBlockMessage(
				textMsg("assistant", '<compressed-block id="b1">x</compressed-block>') as BlockMessage,
			),
		).toBe(true);
		expect(isCompressedBlockMessage(textMsg("user", "plain") as BlockMessage)).toBe(
			false,
		);
	});

	it("collects existing block ids", () => {
		const ids = collectExistingBlockIds([
			textMsg("assistant", '<compressed-block id="b1" range="0-2">x</compressed-block>') as BlockMessage,
			textMsg("assistant", '<compressed-block id="b2">y</compressed-block>') as BlockMessage,
		]);
		expect(ids).toEqual(new Set(["b1", "b2"]));
	});
});

describe("parseCompressBlocks() and orderCompressBlocks()", () => {
	it("parses blocks and strips a leading [bN] label", () => {
		const blocks = parseCompressBlocks([
			textMsg(
				"assistant",
				'<compressed-block id="b1" topic="T">[b0]\n\nsummary text</compressed-block>',
			) as BlockMessage,
		]);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].id).toBe("b1");
		expect(blocks[0].topic).toBe("T");
		expect(blocks[0].summary).toBe("summary text");
	});

	it("orders by anchor and renumbers labels", () => {
		const blocks = parseCompressBlocks([
			textMsg("user", "u0") as BlockMessage,
			textMsg(
				"assistant",
				'<compressed-block id="x" topic="A">A</compressed-block>',
			) as BlockMessage,
			textMsg("user", "u1") as BlockMessage,
			textMsg(
				"assistant",
				'<compressed-block id="y" topic="B">B</compressed-block>',
			) as BlockMessage,
		]);
		const ordered = orderCompressBlocks(blocks);
		expect(ordered.map((b) => b.label)).toEqual(["b0", "b1"]);
		expect(ordered.map((b) => b.topic)).toEqual(["A", "B"]);
	});

	it("renders the block body with the label", () => {
		expect(renderBlockBody("b2", "hello")).toBe("[b2]\n\nhello");
	});
});

describe("selectDeterministicSpan()", () => {
	it("selects messages after the newest block, excluding the protected tail", () => {
		const messages: BlockMessage[] = [
			textMsg("user", "u0") as BlockMessage,
			textMsg("assistant", '<compressed-block id="b1">old</compressed-block>') as BlockMessage,
			textMsg("user", "u1") as BlockMessage,
			textMsg("assistant", "a1") as BlockMessage,
			textMsg("user", "u2") as BlockMessage,
			textMsg("assistant", "a2") as BlockMessage,
			textMsg("user", "u3") as BlockMessage,
		];
		// protectedTurns = 1 protects the last user turn (index 6).
		const span = selectDeterministicSpan(messages, { protectedTurns: 1 });
		expect(span).toEqual({ start: 2, end: 5 });
	});

	it("returns undefined when everything is protected", () => {
		const messages: BlockMessage[] = [
			textMsg("user", "u0") as BlockMessage,
			textMsg("assistant", "a0") as BlockMessage,
		];
		expect(selectDeterministicSpan(messages, { protectedTurns: 3 })).toBeUndefined();
	});

	it("returns undefined when no new messages follow the newest block", () => {
		const messages: BlockMessage[] = [
			textMsg("user", "u0") as BlockMessage,
			textMsg("assistant", '<compressed-block id="b1">x</compressed-block>') as BlockMessage,
		];
		expect(selectDeterministicSpan(messages, { protectedTurns: 1 })).toBeUndefined();
	});

	it("skips synthetic block messages in the candidate queue", () => {
		const messages: BlockMessage[] = [
			textMsg("user", "u0") as BlockMessage,
			textMsg("assistant", "a0") as BlockMessage,
			textMsg("assistant", '<compressed-block id="b1">x</compressed-block>') as BlockMessage,
			textMsg("user", "u1") as BlockMessage,
			textMsg("assistant", "a1") as BlockMessage,
			textMsg("user", "u2") as BlockMessage,
		];
		const span = selectDeterministicSpan(messages, { protectedTurns: 1 });
		expect(span).toEqual({ start: 3, end: 4 });
	});
});
