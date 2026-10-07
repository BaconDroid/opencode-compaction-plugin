/**
 * Provider implementations for the optional external adapters (the SDK/OS
 * boundary). This module turns config into concrete `Embedder`/`Judge` objects;
 * the pure contracts live in `../core/adapters.ts`.
 *
 * No dependency is added: HTTP uses the platform `fetch`, commands use
 * `node:child_process`. Providers never throw at resolution time — when a
 * provider is unusable (missing field, unsupported transport) `undefined` is
 * returned and the caller keeps its deterministic fallback. Runtime errors are
 * caught by the caller (fail-open).
 *
 * Secrets: URLs and commands are user-supplied and are never logged; only the
 * provider name and the reason for disabling are.
 */

import { spawn } from "node:child_process";
import type { Embedder, Judge } from "../core/adapters.js";
import type {
	AdapterProvider,
	EmbeddingsAdapterConfig,
	JudgeAdapterConfig,
} from "../config/config.js";
import type { Logger } from "../types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface AdapterResolutionDeps {
	logger: Logger;
	/** Injectable fetch for tests (defaults to the platform fetch). */
	fetcher?: typeof fetch;
}

/** The subset of fields shared by every adapter config block. */
type TransportConfig = {
	enabled?: boolean;
	provider?: AdapterProvider;
	url?: string;
	command?: string;
	model?: string;
	timeoutMs?: number;
};

type ResolvedTransport =
	| {
			provider: "http";
			url: string;
			model?: string;
			timeoutMs: number;
			fetcher: typeof fetch;
	  }
	| {
			provider: "command";
			command: string;
			model?: string;
			timeoutMs: number;
	  };

/**
 * Normalise the many embedding response shapes into `number[][]`.
 * Accepts a bare array, `{ embeddings: number[][] }` or the OpenAI
 * `{ data: [{ embedding: number[] }] }`.
 */
export function parseEmbeddings(
	payload: unknown,
	expected: number,
): number[][] {
	const rows = extractRows(payload);
	if (!rows) throw new Error("embedding response has no vectors");
	if (rows.length !== expected) {
		throw new Error(
			`embedding response has ${rows.length} vectors, expected ${expected}`,
		);
	}
	for (const row of rows) {
		if (
			!Array.isArray(row) ||
			!row.every((value) => typeof value === "number")
		) {
			throw new Error("embedding response contains a non-numeric vector");
		}
	}
	return rows as number[][];
}

function extractRows(payload: unknown): unknown[] | undefined {
	if (Array.isArray(payload)) return payload;
	if (payload && typeof payload === "object") {
		const obj = payload as Record<string, unknown>;
		if (Array.isArray(obj.embeddings)) return obj.embeddings;
		if (Array.isArray(obj.data)) {
			return obj.data.map((entry) =>
				entry && typeof entry === "object"
					? (entry as Record<string, unknown>).embedding
					: entry,
			);
		}
	}
	return undefined;
}

/**
 * Normalise the common judge response shapes into text. Accepts a bare string,
 * Ollama's `{ response }`, `{ content }`/`{ text }`/`{ answer }` or the OpenAI
 * `{ choices: [{ message: { content } }] }`.
 */
export function parseJudgeResponse(payload: unknown): string {
	if (typeof payload === "string") return payload;
	if (payload && typeof payload === "object") {
		const obj = payload as Record<string, unknown>;
		for (const key of ["response", "content", "text", "answer"]) {
			if (typeof obj[key] === "string") return obj[key] as string;
		}
		if (Array.isArray(obj.choices)) {
			const first = obj.choices[0] as Record<string, unknown> | undefined;
			const message = first?.message as Record<string, unknown> | undefined;
			if (typeof message?.content === "string") return message.content;
			if (typeof first?.text === "string") return first.text;
		}
	}
	throw new Error("judge response has no text");
}

/** POST JSON and return the parsed response, with a timeout. */
async function postJson(
	url: string,
	body: unknown,
	timeoutMs: number,
	fetcher: typeof fetch,
	label: string,
): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetcher(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`${label} endpoint returned HTTP ${response.status}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Spawn `command`, write `body` on stdin and resolve with stdout. The process
 * is non-interactive (stdin is closed after the write) and killed on timeout.
 */
function runCommand(
	command: string,
	body: string,
	timeoutMs: number,
	label: string,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, {
				shell: true,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			reject(error);
			return;
		}

		let stdout = "";
		let settled = false;
		const finish = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(() => reject(new Error(`${label} command timed out`)));
		}, timeoutMs);

		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) => {
			if (code !== 0) {
				finish(() =>
					reject(new Error(`${label} command exited with code ${code}`)),
				);
				return;
			}
			finish(() => resolve(stdout));
		});
		child.stdin?.on("error", (error) => finish(() => reject(error)));
		child.stdin?.end(body);
	});
}

function embeddingBody(model: string | undefined, texts: string[]): string {
	return JSON.stringify(model ? { model, input: texts } : { input: texts });
}

function judgeBody(model: string | undefined, prompt: string): string {
	return JSON.stringify(model ? { model, prompt } : { prompt });
}

function httpEmbedder(
	url: string,
	model: string | undefined,
	timeoutMs: number,
	fetcher: typeof fetch,
): Embedder {
	return {
		async embed(texts) {
			const payload = await postJson(
				url,
				model ? { model, input: texts } : { input: texts },
				timeoutMs,
				fetcher,
				"embedding",
			);
			return parseEmbeddings(payload, texts.length);
		},
	};
}

function commandEmbedder(
	command: string,
	model: string | undefined,
	timeoutMs: number,
): Embedder {
	return {
		async embed(texts) {
			const stdout = await runCommand(
				command,
				embeddingBody(model, texts),
				timeoutMs,
				"embedding",
			);
			return parseEmbeddings(JSON.parse(stdout), texts.length);
		},
	};
}

function httpJudge(
	url: string,
	model: string | undefined,
	timeoutMs: number,
	fetcher: typeof fetch,
): Judge {
	return {
		async ask(prompt) {
			const body = model
				? { model, messages: [{ role: "user", content: prompt }] }
				: { messages: [{ role: "user", content: prompt }] };
			const payload = await postJson(
				url,
				body,
				timeoutMs,
				fetcher,
				"judge",
			);
			return parseJudgeResponse(payload);
		},
	};
}

function commandJudge(
	command: string,
	model: string | undefined,
	timeoutMs: number,
): Judge {
	return {
		async ask(prompt) {
			const stdout = await runCommand(
				command,
				judgeBody(model, prompt),
				timeoutMs,
				"judge",
			);
			return parseCommandText(stdout);
		},
	};
}

/** Parse a command's stdout: plain text, or a JSON judge response. */
function parseCommandText(stdout: string): string {
	const trimmed = stdout.trim();
	if (!trimmed) throw new Error("judge command produced no output");
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
	return parseJudgeResponse(parsed);
}

/** Resolve a shared transport from an adapter config, or `undefined`. */
function resolveTransport(
	cfg: TransportConfig | undefined,
	deps: AdapterResolutionDeps,
	kind: string,
): ResolvedTransport | undefined {
	if (!cfg || cfg.enabled === false) return undefined;

	const provider = cfg.provider ?? "http";

	if (provider === "http") {
		if (!cfg.url) {
			deps.logger.info(
				`adapters.${kind}: http provider requires \`url\`; adapter disabled`,
			);
			return undefined;
		}
		const fetcher =
			deps.fetcher ??
			((input: string | URL | Request, init?: RequestInit) =>
				globalThis.fetch(input, init));
		if (typeof fetcher !== "function") {
			deps.logger.info(
				`adapters.${kind}: no fetch available; adapter disabled`,
			);
			return undefined;
		}
		return {
			provider: "http",
			url: cfg.url,
			model: cfg.model,
			timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			fetcher,
		};
	}

	if (provider === "command") {
		if (!cfg.command) {
			deps.logger.info(
				`adapters.${kind}: command provider requires \`command\`; adapter disabled`,
			);
			return undefined;
		}
		return {
			provider: "command",
			command: cfg.command,
			model: cfg.model,
			timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		};
	}

	if (provider === "mcp") {
		deps.logger.info(
			`adapters.${kind}: mcp provider is not supported; fallback in use`,
		);
		return undefined;
	}

	deps.logger.info(
		`adapters.${kind}: unknown provider "${String(provider)}"; adapter disabled`,
	);
	return undefined;
}

/**
 * Resolve an `Embedder` from config, or `undefined` when the adapter is off or
 * unusable. Never throws.
 */
export function resolveEmbedder(
	cfg: EmbeddingsAdapterConfig | undefined,
	deps: AdapterResolutionDeps,
): Embedder | undefined {
	const resolved = resolveTransport(cfg, deps, "embeddings");
	if (!resolved) return undefined;
	if (resolved.provider === "http") {
		return httpEmbedder(
			resolved.url,
			resolved.model,
			resolved.timeoutMs,
			resolved.fetcher,
		);
	}
	return commandEmbedder(
		resolved.command,
		resolved.model,
		resolved.timeoutMs,
	);
}

/**
 * Resolve a `Judge` from config, or `undefined` when the adapter is off or
 * unusable. Never throws.
 */
export function resolveJudge(
	cfg: JudgeAdapterConfig | undefined,
	deps: AdapterResolutionDeps,
): Judge | undefined {
	const resolved = resolveTransport(cfg, deps, "judge");
	if (!resolved) return undefined;
	if (resolved.provider === "http") {
		return httpJudge(
			resolved.url,
			resolved.model,
			resolved.timeoutMs,
			resolved.fetcher,
		);
	}
	return commandJudge(resolved.command, resolved.model, resolved.timeoutMs);
}
