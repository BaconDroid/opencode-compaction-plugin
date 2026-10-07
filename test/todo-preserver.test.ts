import { describe, it, expect } from "vitest";
import { extractTodos, TodoPreserver } from "../src/todo-preserver.ts";

describe("extractTodos()", () => {
	it("extracts from { data: [...] }", () => {
		expect(
			extractTodos({ data: [{ content: "a", status: "pending" }] }),
		).toHaveLength(1);
	});

	it("extracts from an array", () => {
		expect(extractTodos([{ content: "a", status: "pending" }])).toHaveLength(1);
	});

	it("returns an empty array for unknown shapes", () => {
		expect(extractTodos(null)).toEqual([]);
		expect(extractTodos({})).toEqual([]);
		expect(extractTodos("nope")).toEqual([]);
	});
});

describe("TodoPreserver", () => {
	it("captures and takes a snapshot", () => {
		const preserver = new TodoPreserver();
		preserver.capture("s", [{ content: "a", status: "pending" }]);
		expect(preserver.take("s")).toHaveLength(1);
		expect(preserver.take("s")).toBeUndefined();
	});

	it("ignores empty snapshots", () => {
		const preserver = new TodoPreserver();
		preserver.capture("s", []);
		expect(preserver.take("s")).toBeUndefined();
	});

	it("clear and clearAll", () => {
		const preserver = new TodoPreserver();
		preserver.capture("a", [{ content: "x", status: "pending" }]);
		preserver.capture("b", [{ content: "y", status: "pending" }]);
		preserver.clear("a");
		expect(preserver.take("a")).toBeUndefined();
		preserver.clearAll();
		expect(preserver.take("b")).toBeUndefined();
	});

	it("keeps state per instance", () => {
		const a = new TodoPreserver();
		const b = new TodoPreserver();
		a.capture("s", [{ content: "x", status: "pending" }]);
		expect(b.take("s")).toBeUndefined();
	});
});
