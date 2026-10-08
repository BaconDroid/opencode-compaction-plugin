import { describe, it, expect } from "bun:test";
import {
	DEFAULT_ADAPTER_MODEL,
	HOST_MODEL,
	createModelRunner,
	resolveModelRef,
	type ModelRunner,
} from "../src/opencode/model.ts";

function makeClient(reply: (prompt: string) => string) {
	const created: string[] = [];
	const deleted: string[] = [];
	const prompts: Array<{ body: Record<string, unknown> }> = [];
	const session = {
		async create() {
			const id = `s${created.length + 1}`;
			created.push(id);
			return { data: { id } };
		},
		async prompt(input: { body: { parts: Array<{ text: string }> } }) {
			prompts.push(input);
			return {
				data: {
					parts: [{ type: "text", text: reply(input.body.parts[0].text) }],
				},
			};
		},
		async delete(input: { path: { id: string } }) {
			deleted.push(input.path.id);
			return {};
		},
	};
	return { client: { session }, created, deleted, prompts };
}

describe("resolveModelRef()", () => {
	it("splits provider/model and maps host/unset to undefined", () => {
		expect(resolveModelRef(undefined)).toBeUndefined();
		expect(resolveModelRef(HOST_MODEL)).toBeUndefined();
		expect(resolveModelRef("opencode/big-pickle")).toEqual({
			providerID: "opencode",
			modelID: "big-pickle",
		});
		expect(resolveModelRef("a/b/c")).toEqual({
			providerID: "a",
			modelID: "b/c",
		});
	});

	it("rejects malformed refs", () => {
		expect(resolveModelRef("noslash")).toBeUndefined();
		expect(resolveModelRef("/model")).toBeUndefined();
		expect(resolveModelRef("provider/")).toBeUndefined();
	});
});

describe("createModelRunner()", () => {
	it("creates a sandbox session, prompts and deletes it", async () => {
		const { client, created, deleted, prompts } = makeClient(() => "hello");
		const runner = createModelRunner(client, "/tmp/work");
		expect(await runner("prompt")).toBe("hello");
		expect(created).toEqual(["s1"]);
		expect(deleted).toEqual(["s1"]);
		expect(prompts[0].body.parts).toEqual([{ type: "text", text: "prompt" }]);
		expect(prompts[0].body.tools).toMatchObject({ bash: false, edit: false });
	});

	it("defaults to the free model and honours host", async () => {
		const { client, prompts } = makeClient(() => "ok");
		const runner = createModelRunner(client, "/tmp/work");
		await runner("p");
		expect(prompts[0].body.model).toEqual({
			providerID: "opencode",
			modelID: "big-pickle",
		});
		expect(DEFAULT_ADAPTER_MODEL).toBe("opencode/big-pickle");

		await runner("p", { model: HOST_MODEL });
		expect(prompts[1].body.model).toBeUndefined();
	});

	it("returns empty when the client has no session methods", async () => {
		expect(await createModelRunner({}, "/tmp")("p")).toBe("");
		expect(await createModelRunner(undefined, "/tmp")("p")).toBe("");
	});

	it("is fail-open on a prompt error and still deletes the session", async () => {
		const deleted: string[] = [];
		const client = {
			session: {
				async create() {
					return { data: { id: "s1" } };
				},
				async prompt(): Promise<never> {
					throw new Error("boom");
				},
				async delete(input: { path: { id: string } }) {
					deleted.push(input.path.id);
					return {};
				},
			},
		};
		expect(await createModelRunner(client, "/tmp")("p")).toBe("");
		expect(deleted).toEqual(["s1"]);
	});

	it("times out a hung prompt (fail-open)", async () => {
		const client = {
			session: {
				async create() {
					return { data: { id: "s1" } };
				},
				prompt() {
					return new Promise(() => {});
				},
				async delete() {
					return {};
				},
			},
		};
		expect(
			await createModelRunner(client, "/tmp")("p", { timeoutMs: 10 }),
		).toBe("");
	});

	it("never nests a model call (re-entrancy guard)", async () => {
		let runner: ModelRunner;
		const client = {
			session: {
				async create() {
					return { data: { id: "s1" } };
				},
				async prompt(input: { body: { parts: Array<{ text: string }> } }) {
					const nested = await runner("nested");
					return {
						data: {
							parts: [{ type: "text", text: `outer:${nested}` }],
						},
					};
				},
				async delete() {
					return {};
				},
			},
		};
		runner = createModelRunner(client, "/tmp");
		expect(await runner("p")).toBe("outer:");
	});
});
