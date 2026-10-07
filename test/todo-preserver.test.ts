import { describe, it, expect } from "bun:test";
import {
	extractTodos,
	renderTaskState,
	TodoPreserver,
} from "../src/todo-preserver.ts";

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

describe("renderTaskState()", () => {
	it("renders status markers, ids and priorities", () => {
		const rendered = renderTaskState([
			{ id: "t1", content: "write tests", status: "in_progress", priority: "high" },
			{ id: "t2", content: "ship it", status: "completed" },
			{ id: "t3", content: "later", status: "pending" },
		]);
		expect(rendered).toContain("- [~] write tests (id=t1, status=in_progress, priority=high)");
		expect(rendered).toContain("- [x] ship it (id=t2, status=completed)");
		expect(rendered).toContain("- [ ] later (id=t3, status=pending)");
	});

	it("renders cancelled as [-] and unknown status as [ ]", () => {
		const rendered = renderTaskState([
			{ content: "dropped", status: "cancelled" },
			{ content: "mystery", status: "weird" },
		]);
		expect(rendered).toContain("- [-] dropped");
		expect(rendered).toContain("- [ ] mystery");
	});

	it("returns (none) for an empty list", () => {
		expect(renderTaskState([])).toBe("(none)");
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

	it("peek returns without consuming", () => {
		const preserver = new TodoPreserver();
		preserver.capture("s", [{ content: "a", status: "pending" }]);
		expect(preserver.peek("s")).toHaveLength(1);
		expect(preserver.peek("s")).toHaveLength(1);
		expect(preserver.take("s")).toHaveLength(1);
		expect(preserver.peek("s")).toBeUndefined();
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
