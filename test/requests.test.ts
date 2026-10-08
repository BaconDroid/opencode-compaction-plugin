import { describe, it, expect } from "bun:test";
import { applyPendingRequests } from "../src/core/requests.ts";
import { CompressionStore } from "../src/core/compress.ts";
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
		const expandStore = new ExpandStore();
		const expansions = new ExpansionSidecar();
		expansions.save("s", "blk", [
			{ info: { role: "user" }, parts: [{ type: "text", text: "original" }] },
		], { label: "b0" });

		// The expand tool call (c-exp) is inside the range the compression removes.
		const messages = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "u0" }] },
			{
				info: { role: "assistant" },
				parts: [
					{ type: "tool", tool: "expand", callID: "c-exp", state: { output: "ok" } },
				],
			},
			blockMsg("blk", "b0", "[b0]\n\nexisting"),
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
		expandStore.queue("s", {
			block: "b0",
			mode: "once",
			timestamp: Date.now(),
			callID: "c-exp",
		});

		applyPendingRequests(messages as never, {
			config: mergeConfig({}),
			logger: recordingLogger().logger,
			compressions,
			expansions,
			expandStore,
		});

		// The compression removed the expand tool call, so the expand must be
		// deferred, not applied against the post-compression messages.
		const text = messages
			.map((m) => (m.parts[0] as { text?: string }).text ?? "")
			.join("\n");
		expect(text).not.toContain("original");
		expect(expandStore.drain("s")).toHaveLength(1);
	});
});
