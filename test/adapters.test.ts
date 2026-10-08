import { describe, it, expect, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EmbeddingVectorIndex,
	RerankVectorIndex,
	cosineSimilarity,
	type CorpusItem,
	type Embedder,
	type Reranker,
} from "../src/core/adapters.ts";
import {
	ExpansionSidecar,
	renderHits,
	semanticHits,
	type SearchHit,
} from "../src/core/expand.ts";
import { buildSearchToolDef } from "../src/opencode/tools.ts";
import {
	parseEmbeddings,
	parseRankedIds,
	parseTokenEstimates,
	resolveEmbedder,
	resolveReranker,
	resolveScorer,
} from "../src/opencode/adapters.ts";
import { LiveCompactionPlugin } from "../src/index.ts";
import { makeTmpSetup, recordingLogger } from "./helpers.ts";

function textMsg(role: string, text: string) {
	return { info: { role }, parts: [{ type: "text", text }] };
}

/** A deterministic embedder: each text maps to a fixed vector by keyword. */
function keywordEmbedder(
	vectors: Record<string, number[]>,
	fallback: number[] = [0, 0, 1],
): Embedder {
	return {
		async embed(texts) {
			return texts.map((text) => {
				for (const [needle, vector] of Object.entries(vectors)) {
					if (text.toLowerCase().includes(needle)) return vector;
				}
				return fallback;
			});
		},
	};
}

describe("cosineSimilarity()", () => {
	it("returns 1 for identical, 0 for orthogonal, 0 for zero vectors", () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
	});

	it("uses the shorter length when vectors differ", () => {
		expect(cosineSimilarity([1, 0, 9], [1, 0])).toBeCloseTo(1);
	});
});

describe("EmbeddingVectorIndex", () => {
	const corpus = [
		{ id: "a", text: "fix the login bug" },
		{ id: "b", text: "write the changelog" },
	];

	it("ranks by similarity and returns at most k", async () => {
		const embedder = keywordEmbedder({
			login: [1, 0, 0],
			changelog: [0, 1, 0],
		});
		const index = new EmbeddingVectorIndex(embedder, () => corpus, 0.5);
		expect((await index.search("login", 5)).map((h) => h.id)).toEqual(["a"]);
		expect((await index.search("changelog", 5)).map((h) => h.id)).toEqual([
			"b",
		]);
		const same: Embedder = {
			async embed(texts) {
				return texts.map(() => [1, 0]);
			},
		};
		const limited = new EmbeddingVectorIndex(same, () => corpus);
		expect(await limited.search("q", 1)).toHaveLength(1);
	});

	it("returns [] for an empty query, k <= 0 or an empty corpus", async () => {
		const index = new EmbeddingVectorIndex(
			keywordEmbedder({}),
			() => corpus,
		);
		expect(await index.search("", 5)).toEqual([]);
		expect(await index.search("  ", 5)).toEqual([]);
		expect(await index.search("login", 0)).toEqual([]);
		const empty = new EmbeddingVectorIndex(
			keywordEmbedder({}),
			() => [],
		);
		expect(await empty.search("login", 5)).toEqual([]);
	});

	it("caches corpus embeddings across searches", async () => {
		let calls = 0;
		const embedder: Embedder = {
			async embed(texts) {
				calls++;
				return texts.map(() => [1, 0]);
			},
		};
		const index = new EmbeddingVectorIndex(embedder, () => corpus);
		await index.search("one", 5);
		await index.search("two", 5);
		// 1 corpus batch + 1 query per search (corpus not re-embedded).
		expect(calls).toBe(3);
	});

	it("picks up corpus entries added after the first search", async () => {
		let items = [{ id: "a", text: "alpha" }];
		const index = new EmbeddingVectorIndex(keywordEmbedder({}), () => items);
		expect(await index.search("x", 5)).toHaveLength(1);
		items = [...items, { id: "b", text: "beta" }];
		expect((await index.search("x", 5)).length).toBe(2);
	});

	it("drops hits below minScore", async () => {
		const embedder = keywordEmbedder({ login: [1, 0, 0] });
		const index = new EmbeddingVectorIndex(embedder, () => corpus, 0.9);
		// "login" only matches item a (score 1); item b is orthogonal (0).
		const hits = await index.search("login", 5);
		expect(hits.map((h) => h.id)).toEqual(["a"]);
	});

	it("throws when the embedder returns the wrong number of vectors", async () => {
		const bad: Embedder = { async embed() { return [[1, 0]]; } };
		const index = new EmbeddingVectorIndex(bad, () => corpus);
		await expect(index.search("q", 5)).rejects.toThrow("vectors for");
	});

	it("skips empty-text corpus items", async () => {
		// A provider-like embedder that rejects empty input.
		const embedder: Embedder = {
			async embed(texts) {
				if (texts.some((t) => !t.trim())) throw new Error("empty input");
				return texts.map((t) => (t.includes("alpha") ? [1, 0] : [0, 1]));
			},
		};
		const index = new EmbeddingVectorIndex(embedder, () => [
			{ id: "empty", text: "" },
			{ id: "ok", text: "alpha" },
		]);
		const hits = await index.search("alpha", 5);
		expect(hits.map((h) => h.id)).toEqual(["ok"]);
	});

	it("keeps separate cache entries for colliding ids with different text", async () => {
		let calls = 0;
		const embedder: Embedder = {
			async embed(inputs) {
				calls++;
				return inputs.map(() => [1, 0]);
			},
		};
		const bySession: Record<string, { id: string; text: string }[]> = {
			A: [{ id: "x", text: "alpha" }],
			B: [{ id: "x", text: "beta" }],
		};
		const index = new EmbeddingVectorIndex(
			embedder,
			(sessionID) => bySession[sessionID ?? ""] ?? [],
		);
		await index.search("q", 5, "A");
		await index.search("q", 5, "B");
		const before = calls;
		await index.search("q", 5, "A");
		await index.search("q", 5, "B");
		// Both corpora are cached: only the two query embeddings remain.
		expect(calls - before).toBe(2);

		index.clearSession("A");
		const afterClear = calls;
		await index.search("q", 5, "A");
		await index.search("q", 5, "B");
		// A re-embeds (corpus + query); B is still cached (query only).
		expect(calls - afterClear).toBe(3);
	});

	it("scopes the corpus by session id", async () => {
		const bySession: Record<string, { id: string; text: string }[]> = {
			a: [{ id: "a1", text: "alpha" }],
			b: [{ id: "b1", text: "beta" }],
		};
		const index = new EmbeddingVectorIndex(
			keywordEmbedder({}),
			(sessionID) => bySession[sessionID ?? ""] ?? [],
		);
		expect((await index.search("q", 5, "a")).map((h) => h.id)).toEqual(["a1"]);
		expect((await index.search("q", 5, "b")).map((h) => h.id)).toEqual(["b1"]);
	});

	it("clear() forces re-embedding", async () => {
		let calls = 0;
		const embedder: Embedder = {
			async embed(texts) {
				calls++;
				return texts.map(() => [1, 0]);
			},
		};
		const index = new EmbeddingVectorIndex(embedder, () => corpus);
		await index.search("one", 5);
		index.clear();
		await index.search("two", 5);
		expect(calls).toBe(4);
	});
});

describe("semanticHits() & renderHits()", () => {
	it("enriches hits with sidecar metadata and a snippet", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "fix the login bug now")], {
			label: "b0",
			topic: "Auth",
		});
		const hits = semanticHits(sidecar, [{ id: "id-1", score: 0.8 }]);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ id: "id-1", label: "b0", topic: "Auth" });
		expect(hits[0].snippet).toContain("login");
	});

	it("drops unknown ids and truncates long snippets", () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "x".repeat(300))], {
			label: "b0",
		});
		expect(semanticHits(sidecar, [{ id: "missing", score: 1 }])).toEqual([]);
		const [hit] = semanticHits(sidecar, [{ id: "id-1", score: 1 }], 10);
		expect(hit.snippet.endsWith("…")).toBe(true);
	});

	it("labels semantic and keyword reports distinctly", () => {
		const hits: SearchHit[] = [{ id: "id-1", label: "b0", snippet: "s" }];
		expect(renderHits(hits, "q", "semantic")).toContain("(semantic)");
		expect(renderHits(hits, "q", "keyword")).not.toContain("(semantic)");
		expect(renderHits([], "q", "semantic")).toContain("semantically");
		expect(renderHits([], "q", "keyword")).toContain(
			'No stored block matches "q"',
		);
	});
});

describe("search tool with a semantic index", () => {
	it("uses semantic hits when the index returns matches", async () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "hello world")], {
			label: "b0",
		});
		const { logger } = recordingLogger();
		const search = buildSearchToolDef(sidecar, 5, {
			index: { async search() { return [{ id: "id-1", score: 0.9 }]; } },
			logger,
		});
		const result = await search.execute({ query: "anything" }, {} as any);
		expect(result).toContain("[b0]");
		expect(result).toContain("(semantic)");
	});

	it("falls back to keyword search when the index throws", async () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "hello world")], {
			label: "b0",
		});
		const { logger, messages } = recordingLogger();
		const search = buildSearchToolDef(sidecar, 5, {
			index: {
				async search() {
					throw new Error("boom");
				},
			},
			logger,
		});
		const result = await search.execute({ query: "world" }, {} as any);
		expect(result).toContain("[b0]");
		expect(result).not.toContain("(semantic)");
		expect(messages).toContain("semantic search failed; using keyword search");
	});

	it("falls back to keyword search when the index returns no hits", async () => {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "hello world")], {
			label: "b0",
		});
		const { logger } = recordingLogger();
		const search = buildSearchToolDef(sidecar, 5, {
			index: { async search() { return []; } },
			logger,
		});
		expect(await search.execute({ query: "world" }, {} as any)).toContain(
			"[b0]",
		);
	});
});

describe("search tool rerank gating", () => {
	function setup() {
		const sidecar = new ExpansionSidecar();
		sidecar.save("s", "id-1", [textMsg("user", "hello world")], { label: "b0" });
		let called = 0;
		const { logger } = recordingLogger();
		const search = buildSearchToolDef(sidecar, 5, {
			index: {
				async search() {
					called++;
					return [{ id: "id-1", score: 1 }];
				},
			},
			logger,
			mode: "rerank",
		});
		return { search, calls: () => called };
	}

	it("uses keyword results without calling the model when the keyword matches", async () => {
		const { search, calls } = setup();
		const result = await search.execute({ query: "hello" }, {} as any);
		expect(result).toContain("[b0]");
		expect(result).not.toContain("(semantic)");
		expect(calls()).toBe(0);
	});

	it("falls back to the model when the keyword finds nothing", async () => {
		const { search, calls } = setup();
		const result = await search.execute({ query: "absent" }, {} as any);
		expect(calls()).toBe(1);
		expect(result).toContain("(semantic)");
	});
});

describe("parseEmbeddings()", () => {
	it("accepts bare arrays, {embeddings} and OpenAI {data}", () => {
		expect(parseEmbeddings([[1, 2]], 1)).toEqual([[1, 2]]);
		expect(parseEmbeddings({ embeddings: [[1, 2]] }, 1)).toEqual([[1, 2]]);
		expect(
			parseEmbeddings({ data: [{ embedding: [1, 2] }] }, 1),
		).toEqual([[1, 2]]);
	});

	it("rejects missing, mis-sized or non-numeric vectors", () => {
		expect(() => parseEmbeddings({}, 1)).toThrow("no vectors");
		expect(() => parseEmbeddings([[1, 2]], 2)).toThrow("expected 2");
		expect(() => parseEmbeddings([["a"]], 1)).toThrow("non-numeric");
	});
});

describe("resolveEmbedder()", () => {
	const deps = () => recordingLogger();

	it("returns undefined when unset, disabled or missing a required field", () => {
		expect(resolveEmbedder(undefined, deps())).toBeUndefined();
		expect(resolveEmbedder({ enabled: false, url: "u" }, deps())).toBeUndefined();
		expect(resolveEmbedder({ provider: "http" }, deps())).toBeUndefined();
		expect(resolveEmbedder({ provider: "command" }, deps())).toBeUndefined();
	});

	it("returns undefined for mcp and unknown providers", () => {
		const { logger, messages } = deps();
		expect(resolveEmbedder({ provider: "mcp" }, { logger })).toBeUndefined();
		expect(messages.some((m) => m.includes("mcp provider is not supported"))).toBe(
			true,
		);
		const { logger: l2, messages: m2 } = deps();
		expect(
			resolveEmbedder({ provider: "nope" as any }, { logger: l2 }),
		).toBeUndefined();
		expect(m2.some((m) => m.includes("unknown provider"))).toBe(true);
	});

	it("builds an http embedder that parses a successful response", async () => {
		let seenBody = "";
		const fetcher = (async (_url: unknown, init?: RequestInit) => {
			seenBody = String(init?.body);
			return {
				ok: true,
				status: 200,
				json: async () => ({ data: [{ embedding: [1, 0] }] }),
			};
		}) as unknown as typeof fetch;
		const embedder = resolveEmbedder(
			{ provider: "http", url: "http://localhost/embed", model: "m" },
			{ logger: deps().logger, fetcher },
		);
		expect(embedder).toBeDefined();
		expect(await embedder!.embed(["hello"])).toEqual([[1, 0]]);
		expect(seenBody).toContain('"model":"m"');
	});

	it("throws on an HTTP error status (caught by the caller)", async () => {
		const fetcher = (async () => ({
			ok: false,
			status: 500,
			json: async () => ({}),
		})) as unknown as typeof fetch;
		const embedder = resolveEmbedder(
			{ provider: "http", url: "http://localhost/embed" },
			{ logger: deps().logger, fetcher },
		);
		await expect(embedder!.embed(["x"])).rejects.toThrow("HTTP 500");
	});
});

describe("command embedder", () => {
	const dir = mkdtempSync(join(tmpdir(), "lc-adapter-"));
	const okScript = join(dir, "ok.mjs");
	const failScript = join(dir, "fail.mjs");
	writeFileSync(
		okScript,
		`let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const {input}=JSON.parse(d);process.stdout.write(JSON.stringify({embeddings:input.map(()=>[1,0])}))});`,
	);
	writeFileSync(failScript, "process.exit(3);");
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("spawns the command, pipes stdin and parses stdout", async () => {
		const embedder = resolveEmbedder(
			{
				provider: "command",
				command: `"${process.execPath}" "${okScript}"`,
			},
			{ logger: recordingLogger().logger },
		);
		expect(embedder).toBeDefined();
		expect(await embedder!.embed(["a", "b"])).toEqual([
			[1, 0],
			[1, 0],
		]);
	});

	it("rejects when the command exits non-zero", async () => {
		const embedder = resolveEmbedder(
			{
				provider: "command",
				command: `"${process.execPath}" "${failScript}"`,
			},
			{ logger: recordingLogger().logger },
		);
		await expect(embedder!.embed(["a"])).rejects.toThrow("exited with code 3");
	});
});

describe("plugin wiring: semantic search adapter", () => {
	const dir = mkdtempSync(join(tmpdir(), "lc-wiring-"));
	const script = join(dir, "embed.mjs");
	writeFileSync(
		script,
		`let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const {input}=JSON.parse(d);process.stdout.write(JSON.stringify({embeddings:input.map(()=>[1,0])}))});`,
	);
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const TMP_DIR = join(import.meta.dirname, "__tmp_wiring_test");
	const { setup, cleanup } = makeTmpSetup(TMP_DIR);
	beforeEach(setup);
	afterEach(cleanup);

	it("indexes compressed blocks and searches them semantically", async () => {
		const logs: string[] = [];
		const ctx = {
			client: {
				app: {
					log: (input: { body: { message: string } }) => {
						logs.push(input.body.message);
						return Promise.resolve();
					},
				},
			},
			project: { id: "p", name: "p" },
			directory: TMP_DIR,
			worktree: TMP_DIR,
			serverUrl: new URL("http://localhost:4096"),
		};
		const hooks = await LiveCompactionPlugin(ctx as any, {
			debug: true,
			compress: { reversible: true },
			adapters: {
				embeddings: {
					provider: "command",
					command: `"${process.execPath}" "${script}"`,
				},
			},
		} as any);

		await hooks["tool.execute.after"]!(
			{
				tool: "compress",
				sessionID: "s1",
				callID: "c1",
				args: { topic: "Auth", start: 0, end: 3, summary: "login flow" },
			},
			{ title: "", output: "", metadata: {} },
		);
		const messages = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "fix auth" }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "investigating" }] },
			{ info: { role: "user" }, parts: [{ type: "text", text: "try this" }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] },
			{
				info: { role: "user" },
				parts: [
					{ type: "text", text: "next" },
					{
						type: "tool",
						tool: "compress",
						callID: "c1",
						state: { output: "compressed" },
					},
				],
			},
		];
		await hooks["experimental.chat.messages.transform"]!(
			{} as any,
			{ messages } as any,
		);
		expect(logs).toContain("semantic search adapter enabled");

		const search = (hooks as any).tool.search;
		const result = await search.execute({ query: "login" }, {});
		expect(result).toContain("(semantic)");
		expect(result).toContain("[b0]");
	});
});

describe("RerankVectorIndex", () => {
	const corpus: CorpusItem[] = [
		{ id: "a", text: "fix the login bug" },
		{ id: "b", text: "write the changelog" },
	];

	it("delegates to the reranker and caps to k", async () => {
		const seen: CorpusItem[][] = [];
		const reranker: Reranker = {
			async rank(_query, items) {
				seen.push(items);
				return [
					{ id: "b", score: 1 },
					{ id: "a", score: 0.5 },
				];
			},
		};
		const index = new RerankVectorIndex(reranker, () => corpus);
		expect((await index.search("login", 5)).map((h) => h.id)).toEqual(["b", "a"]);
		expect(await index.search("login", 1)).toHaveLength(1);
		expect(seen[0]).toEqual(corpus);
	});

	it("returns [] for an empty query, k <= 0 or an empty corpus", async () => {
		const reranker: Reranker = {
			async rank() {
				return [{ id: "a", score: 1 }];
			},
		};
		const index = new RerankVectorIndex(reranker, () => corpus);
		expect(await index.search("", 5)).toEqual([]);
		expect(await index.search("  ", 5)).toEqual([]);
		expect(await index.search("q", 0)).toEqual([]);
		expect(
			await new RerankVectorIndex(reranker, () => []).search("q", 5),
		).toEqual([]);
	});

	it("drops invented ids and caps the candidates offered to the model", async () => {
		const reranker: Reranker = {
			async rank(_query, items) {
				return [
					{ id: "ghost", score: 1 },
					{ id: items[0].id, score: 0.5 },
				];
			},
		};
		const index = new RerankVectorIndex(reranker, () => corpus, 1);
		expect((await index.search("q", 5)).map((h) => h.id)).toEqual(["a"]);
	});
});

describe("parseTokenEstimates() / parseRankedIds()", () => {
	it("parses a numeric array and maps unusable entries to NaN", () => {
		expect(parseTokenEstimates("[5, 7]", 2)).toEqual([5, 7]);
		expect(parseTokenEstimates('here: ["3", 4]', 2)).toEqual([3, 4]);
		expect(Number.isNaN(parseTokenEstimates("[5, null]", 2)[1])).toBe(true);
	});

	it("throws on a missing or mis-sized array", () => {
		expect(() => parseTokenEstimates("nope", 1)).toThrow("no JSON array");
		expect(() => parseTokenEstimates("[1]", 2)).toThrow("estimates for 2");
	});

	it("keeps only known, unique ids in order", () => {
		const allowed = new Set(["a", "b"]);
		expect(parseRankedIds('["b","a"]', allowed, 5)).toEqual(["b", "a"]);
		expect(
			parseRankedIds('[{"id":"a"},{"id":"x"},{"id":"a"}]', allowed, 5),
		).toEqual(["a"]);
		expect(parseRankedIds('["b","a"]', allowed, 1)).toEqual(["b"]);
	});
});

describe("resolveScorer() / resolveReranker() with the opencode provider", () => {
	it("warms the model scorer cache in the background (non-blocking)", async () => {
		let calls = 0;
		const modelRunner = async (prompt: string): Promise<string> => {
			calls++;
			const texts = JSON.parse(prompt.slice(prompt.lastIndexOf("[")));
			return JSON.stringify(texts.map(() => 10));
		};
		const scorer = resolveScorer(
			{ provider: "opencode" },
			{ logger: recordingLogger().logger, modelRunner },
		);
		expect(scorer).toBeDefined();
		// The first call returns nothing yet (heuristic) and schedules a fill.
		const first = await scorer!.scoreMany!(["a", "b"]);
		expect(first.every((value) => Number.isNaN(value))).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toBe(1);
		// The warmed cache is used on the next call.
		expect(await scorer!.scoreMany!(["a", "b"])).toEqual([10, 10]);
		expect(await scorer!.score("a")).toBe(10);
	});

	it("disables the opencode scorer without a runner", () => {
		const { logger, messages } = recordingLogger();
		expect(resolveScorer({ provider: "opencode" }, { logger })).toBeUndefined();
		expect(messages.some((m) => m.includes("requires an SDK client"))).toBe(true);
	});

	it("builds a model reranker and filters ids", async () => {
		const reranker = resolveReranker(
			{ provider: "opencode" },
			{
				logger: recordingLogger().logger,
				modelRunner: async () => '["b"]',
			},
		);
		expect(reranker).toBeDefined();
		const hits = await reranker!.rank(
			"q",
			[
				{ id: "a", text: "alpha" },
				{ id: "b", text: "beta" },
			],
			5,
		);
		expect(hits.map((h) => h.id)).toEqual(["b"]);
	});

	it("defaults the rerank provider to opencode and rejects others", () => {
		expect(
			resolveReranker(
				{},
				{ logger: recordingLogger().logger, modelRunner: async () => "[]" },
			),
		).toBeDefined();
		const { logger, messages } = recordingLogger();
		expect(resolveReranker({ provider: "http" }, { logger })).toBeUndefined();
		expect(messages.some((m) => m.includes("not supported"))).toBe(true);
	});
});

describe("resolveEmbedder() rejects the opencode provider", () => {
	it("warns and disables", () => {
		const { logger, messages } = recordingLogger();
		expect(resolveEmbedder({ provider: "opencode" }, { logger })).toBeUndefined();
		expect(messages.some((m) => m.includes("not an embedding provider"))).toBe(
			true,
		);
	});
});

describe("plugin wiring: rerank search adapter", () => {
	const TMP_DIR = join(import.meta.dirname, "__tmp_rerank_test");
	const { setup, cleanup } = makeTmpSetup(TMP_DIR);
	beforeEach(setup);
	afterEach(cleanup);

	it("reranks stored blocks through the opencode model", async () => {
		const logs: string[] = [];
		const ctx = {
			client: {
				app: {
					log: (input: { body: { message: string } }) => {
						logs.push(input.body.message);
						return Promise.resolve();
					},
				},
				session: {
					async create() {
						return { data: { id: "j1" } };
					},
					async prompt(input: { body: { parts: Array<{ text: string }> } }) {
						const text = input.body.parts[0].text;
						const items = JSON.parse(text.slice(text.lastIndexOf("[")));
						return {
							data: {
								parts: [
									{
										type: "text",
										text: JSON.stringify(items.map((i: { id: string }) => i.id)),
									},
								],
							},
						};
					},
					async delete() {
						return {};
					},
				},
			},
			project: { id: "p", name: "p" },
			directory: TMP_DIR,
			worktree: TMP_DIR,
			serverUrl: new URL("http://localhost:4096"),
		};
		const hooks = await LiveCompactionPlugin(ctx as any, {
			debug: true,
			compress: { reversible: true },
			adapters: { rerank: { model: "host" } },
		} as any);

		await hooks["tool.execute.after"]!(
			{
				tool: "compress",
				sessionID: "s1",
				callID: "c1",
				args: { topic: "Auth", start: 0, end: 3, summary: "login flow" },
			},
			{ title: "", output: "", metadata: {} },
		);
		const messages = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "fix auth" }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "investigating" }] },
			{ info: { role: "user" }, parts: [{ type: "text", text: "try this" }] },
			{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] },
			{
				info: { role: "user" },
				parts: [
					{ type: "text", text: "next" },
					{
						type: "tool",
						tool: "compress",
						callID: "c1",
						state: { output: "compressed" },
					},
				],
			},
		];
		await hooks["experimental.chat.messages.transform"]!(
			{} as any,
			{ messages } as any,
		);
		expect(logs).toContain("rerank search adapter enabled");

		const search = (hooks as any).tool.search;
		const result = await search.execute({ query: "login" }, {});
		expect(result).toContain("(semantic)");
		expect(result).toContain("[b0]");
	});
});
