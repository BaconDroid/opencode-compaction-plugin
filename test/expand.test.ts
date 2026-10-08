import { describe, it, expect } from "bun:test";
import {
	ExpansionSidecar,
	ExpandStore,
	applyExpansions,
	renderInspector,
	type ExpandRequest,
} from "../src/core/expand.ts";
import {
	buildExpandToolDef,
	buildInspectToolDef,
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

	it("scopes the list to a session", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("a", "id-a", [textMsg("user", "alpha login")], {
			label: "b0",
		});
		sidecar.save("b", "id-b", [textMsg("user", "beta login")], {
			label: "b0",
		});
		expect(sidecar.listForSession("a").map((r) => r.id)).toEqual(["id-a"]);
		expect(sidecar.listForSession("b").map((r) => r.id)).toEqual(["id-b"]);
		// Without a session id every record is returned (backward compatible).
		expect(sidecar.listForSession()).toHaveLength(2);
	});

	it("returns nothing for a known session with no records", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("a", "id-a", [textMsg("user", "alpha login")], {
			label: "b0",
		});
		expect(sidecar.listForSession("empty")).toEqual([]);
	});

	it("keeps records separate when ids collide across sessions", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("A", "u:100", [textMsg("user", "alpha")], { label: "b0" });
		sidecar.save("B", "u:100", [textMsg("user", "beta")], { label: "b0" });
		expect(sidecar.listForSession("A")).toHaveLength(1);
		expect(
			(sidecar.get("u:100", "A")?.original[0] as any).parts[0].text,
		).toBe("alpha");
		expect(
			(sidecar.get("u:100", "B")?.original[0] as any).parts[0].text,
		).toBe("beta");
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

	it("keeps a sticky expand when a one-shot expand follows", () => {
		const store = new ExpandStore();
		store.queue("s", { block: "b0", mode: "sticky", timestamp: 1 });
		store.queue("s", { block: "b0", mode: "once", timestamp: 2 });
		const drained = store.drain("s");
		expect(drained).toHaveLength(1);
		expect(drained[0].mode).toBe("sticky");
		// Still retained for the next transform.
		expect(store.drain("s")).toHaveLength(1);
	});

	it("dedupes by block and prunes unmatched sticky requests", () => {
		const store = new ExpandStore();
		store.queue("s", { block: "b0", mode: "sticky", timestamp: 1 });
		store.queue("s", { block: "b0", mode: "sticky", timestamp: 2 });
		expect(store.drain("s")).toHaveLength(1); // one per block
		// The block no longer resolves: the retained sticky request is dropped.
		store.prune("s", ["b0"]);
		expect(store.drain("s")).toHaveLength(0);
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

	it("clones originals so a later mutation cannot corrupt the sidecar", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "ORIGINAL")], { label: "b0" });

		const first = [blockMsg("id-1", "b0", "[b0]\n\nsummary")];
		applyExpansions(
			first as any,
			[{ block: "b0", mode: "once", timestamp: 1 }],
			sidecar,
			"s",
		);
		// Later stages mutate the restored message in place.
		(first[0].parts[0] as any).text = "MUTATED";

		const second = [blockMsg("id-1", "b0", "[b0]\n\nsummary")];
		applyExpansions(
			second as any,
			[{ block: "b0", mode: "once", timestamp: 2 }],
			sidecar,
			"s",
		);
		expect((second[0].parts[0] as any).text).toBe("ORIGINAL");
	});

	it("restores a block once when requested twice", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [
			textMsg("user", "one"),
			textMsg("assistant", "two"),
		]);
		const messages = [
			blockMsg("id-1", "b0", "[b0]\n\nsummary"),
			textMsg("user", "keep"),
		];
		const result = applyExpansions(
			messages as any,
			[
				{ block: "b0", mode: "sticky", timestamp: 1 },
				{ block: "b0", mode: "once", timestamp: 2 },
			],
			sidecar,
		);
		expect(result.expanded).toBe(1);
		expect(messages.map((m) => (m.parts[0] as any).text)).toEqual([
			"one",
			"two",
			"keep",
		]);
	});
});

describe("inspection", () => {
	it("lists stored blocks and renders an inspector", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "alpha")], {
			label: "b0",
			topic: "Auth",
		});
		const report = renderInspector(sidecar);
		expect(report).toContain("[b0]");
		expect(report).toContain("Auth");
		expect(renderInspector(new ExpansionSidecar())).toContain(
			"No compressed blocks",
		);
	});
});

describe("expand/inspect tool definitions", () => {
	it("exposes block + mode arguments and executes in either mode", async () => {
		const expand = buildExpandToolDef();
		expect(expand.args).toHaveProperty("block");
		expect(expand.args).toHaveProperty("mode");
		expect(await expand.execute({ block: "b0" }, {} as any)).toContain(
			"sticky",
		);
		expect(
			await expand.execute({ block: "b1", mode: "once" }, {} as any),
		).toContain("once");
	});

	it("scopes inspect by the tool context session", async () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("a", "id-a", [textMsg("user", "hello alpha")], {
			label: "b0",
		});
		sidecar.save("b", "id-b", [textMsg("user", "hello beta")], {
			label: "b0",
		});

		const inspect = buildInspectToolDef(sidecar);
		const report = await inspect.execute({}, { sessionID: "a" } as any);
		expect(report).toContain("id-a");
		expect(report).not.toContain("id-b");
		// Without a session context every record is listed.
		expect(await inspect.execute({}, {} as any)).toContain("id-a");
	});
});
