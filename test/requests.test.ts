import { describe, it, expect } from "bun:test";
import { applyPendingRequests } from "../src/core/requests.ts";
import { CompressionStore, SquashStore } from "../src/core/compress.ts";
import { ExpansionSidecar, ExpandStore } from "../src/core/expand.ts";
import { mergeConfig } from "../src/config/config.ts";
import { recordingLogger } from "./helpers.ts";

function blockMsg(id: string, label: string, body: string) {
	return {
		info: { role: "assistant" },
		parts: [
			{
				type: "text",
				text: `<compressed-block id="${id}" label="${label}">${body}</compressed-block>`,
			},
		],
	};
}

describe("applyPendingRequests() request scoping", () => {
	it("recomputes present callIDs after a compression removes a tool part", () => {
		const compressions = new CompressionStore();
		const squashes = new SquashStore();
		const expandStore = new ExpandStore();
		const expansions = new ExpansionSidecar();

		// The squash tool call (c-sq) is inside the range the compression removes.
		const messages = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "u0" }] },
			{
				info: { role: "assistant" },
				parts: [
					{ type: "tool", tool: "squash", callID: "c-sq", state: { output: "ok" } },
				],
			},
			blockMsg("a", "b0", "[b0]\n\nfirst"),
			blockMsg("b", "b1", "[b1]\n\nsecond"),
			{
				info: { role: "user" },
				parts: [
					{ type: "text", text: "u4" },
					{
						type: "tool",
						tool: "compress",
						callID: "c-comp",
						state: { output: "ok" },
					},
				],
			},
		];

		compressions.queue("s", {
			topic: "T",
			start: 0,
			end: 1,
			summary: "sum",
			timestamp: Date.now(),
			callID: "c-comp",
		});
		squashes.queue("s", {
			from: "b0",
			to: "b1",
			topic: "M",
			summary: "merged",
			timestamp: Date.now(),
			callID: "c-sq",
		});

		applyPendingRequests(messages as never, {
			config: mergeConfig({}),
			logger: recordingLogger().logger,
			compressions,
			squashes,
			expansions,
			expandStore,
		});

		// The compression removed the squash tool call, so the squash must be
		// deferred, not applied against the post-compression messages.
		const text = messages
			.map((m) => (m.parts[0] as { text?: string }).text ?? "")
			.join("\n");
		expect(text).not.toContain('squashed="true"');
		expect(squashes.drain("s")).toHaveLength(1);
	});
});
