import { describe, it, expect } from "bun:test";
import {
	ExpansionSidecar,
	ExpandStore,
	applyExpansions,
	type ExpandRequest,
} from "../src/core/expand.ts";
import {
	buildExpandToolDef,
	buildRecallToolDef,
} from "../src/opencode/tools.ts";

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

function textMsg(role: string, text: string) {
	return { info: { role }, parts: [{ type: "text", text }] };
}

describe("ExpansionSidecar", () => {
	it("saves and retrieves originals by id", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "b1", [textMsg("user", "original")]);
		expect(sidecar.get("b1")?.original).toHaveLength(1);
		expect(sidecar.size).toBe(1);
	});

	it("clears per session and all", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("a", "b1", []);
		sidecar.save("b", "b2", []);
		sidecar.clear("a");
		expect(sidecar.get("b1")).toBeUndefined();
		expect(sidecar.get("b2")).toBeDefined();
		sidecar.clearAll();
		expect(sidecar.size).toBe(0);
	});
});

describe("ExpandStore", () => {
	it("keeps sticky requests and drops one-shot requests", () => {
		const store = new ExpandStore();
		const sticky: ExpandRequest = {
			block: "b0",
			mode: "sticky",
			timestamp: 1,
		};
		const once: ExpandRequest = { block: "b1", mode: "once", timestamp: 2 };
		store.queue("s", sticky);
		store.queue("s", once);

		expect(store.drain("s")).toHaveLength(2);
		// Sticky retained, one-shot consumed.
		const second = store.drain("s");
		expect(second).toHaveLength(1);
		expect(second[0].block).toBe("b0");
	});
});

describe("applyExpansions()", () => {
	it("replaces a block with its originals", () => {
		const sidecar = new ExpansionSidecar();
		const original = [textMsg("user", "one"), textMsg("assistant", "two")];
		sidecar.save("s", "id-1", original);
		const messages = [blockMsg("id-1", "b0", "[b0]\n\nsummary")];

		const result = applyExpansions(
			messages as any,
			[{ block: "b0", mode: "once", timestamp: 1 }],
			sidecar,
		);
		expect(result.expanded).toBe(1);
		expect(messages).toHaveLength(2);
		expect((messages[0].parts[0] as any).text).toBe("one");
	});

	it("reports unmatched references", () => {
		const sidecar = new ExpansionSidecar();
		const messages = [blockMsg("id-1", "b0", "[b0]\n\nsummary")];
		const result = applyExpansions(
			messages as any,
			[{ block: "b9", mode: "once", timestamp: 1 }],
			sidecar,
		);
		expect(result.expanded).toBe(0);
		expect(result.unmatched).toEqual(["b9"]);
	});
});

describe("expand/recall tool definitions", () => {
	it("expose a block argument and execute", async () => {
		const expand = buildExpandToolDef();
		expect(expand.args).toHaveProperty("block");
		expect(await expand.execute({ block: "b0" }, {} as any)).toContain("b0");
		const recall = buildRecallToolDef();
		expect(recall.args).toHaveProperty("block");
		expect(await recall.execute({ block: "b1" }, {} as any)).toContain("b1");
	});
});
