/**
 * Provider implementations for the optional external adapters (the SDK/OS
 * boundary). This module turns config into concrete `Embedder`/`Judge`/`Scorer`
 * objects; the pure contracts live in `../core/adapters.ts`.
 *
 * All three families share one transport abstraction: an `http` POST or a
 * spawned `command` that reads a JSON payload on stdin. No dependency is added
 * (platform `fetch` + `node:child_process`). Resolution never throws — when a
 * provider is unusable (missing field, unsupported transport) `undefined` is
 * returned and the caller keeps its deterministic fallback; runtime errors are
 * caught by the caller (fail-open).
 *
 * Secrets: URLs and commands are user-supplied and are never logged; only the
 * provider name and the reason for disabling are.
 */

import { spawn } from "node:child_process";
import type { Embedder, Judge, Scorer } from "../core/adapters.js";
import type {
	AdapterTransportConfig,
	EmbeddingsAdapterConfig,
	JudgeAdapterConfig,
	ScorerAdapterConfig,
} from "../config/config.js";
import type { Logger } from "../types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface AdapterResolutionDeps {
	logger: Logger;
	/** Injectable fetch for tests (defaults to the platform fetch). */
	fetcher?: typeof fetch;
}

/** Send a JSON payload and return the parsed response. */
interface Transport {
	send(payload: unknown, label: string): Promise<unknown>;
}

/** A resolved adapter: its transport and the optional model id. */
interface ResolvedAdapter {
	transport: Transport;
	model?: string;
}

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

/**
 * Normalise the common scorer response shapes into a number. Accepts a bare
 * number, a numeric string, `{ score }`/`{ value }`/`{ tokens }`/`{ residual }`
 * or `{ data: [ … ] }`.
 */
export function parseScore(payload: unknown): number {
	if (typeof payload === "number" && Number.isFinite(payload)) return payload;
	if (typeof payload === "string" && Number.isFinite(Number(payload.trim()))) {
		return Number(payload.trim());
	}
	if (payload && typeof payload === "object") {
		const obj = payload as Record<string, unknown>;
		for (const key of ["score", "value", "tokens", "residual"]) {
			const value = obj[key];
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value === "string" && Number.isFinite(Number(value))) {
				return Number(value);
			}
		}
		if (Array.isArray(obj.data) && obj.data.length > 0) {
			return parseScore(obj.data[0]);
		}
	}
	throw new Error("scorer response has no numeric score");
}

/** HTTP transport: POST JSON and return the parsed response, with a timeout. */
function httpTransport(
	url: string,
	timeoutMs: number,
	fetcher: typeof fetch,
): Transport {
	return {
		async send(payload, label) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetcher(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
					signal: controller.signal,
				});
				if (!response.ok) {
					throw new Error(
						`${label} endpoint returned HTTP ${response.status}`,
					);
				}
				return await response.json();
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/**
 * Command transport: spawn `command`, write the JSON payload on stdin and
 * parse stdout. Non-interactive (stdin is closed after the write) and killed on
 * timeout. stdout is parsed as JSON when possible, otherwise used as raw text.
 */
function commandTransport(command: string, timeoutMs: number): Transport {
	return {
		async send(payload, label) {
			const stdout = await runCommand(
				command,
				JSON.stringify(payload),
				timeoutMs,
				label,
			);
			const trimmed = stdout.trim();
			if (!trimmed) throw new Error("adapter command produced no output");
			try {
				return JSON.parse(trimmed);
			} catch {
				return trimmed;
			}
		},
	};
}

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
		// Drain stderr: an unconsumed pipe buffer would block the child (and
		// trip the timeout) even when stdout is valid.
		child.stderr?.resume();
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

function buildEmbedder({ transport, model }: ResolvedAdapter): Embedder {
	return {
		async embed(texts) {
			const payload = await transport.send(
				model ? { model, input: texts } : { input: texts },
				"embedding",
			);
			return parseEmbeddings(payload, texts.length);
		},
	};
}

function buildJudge({ transport, model }: ResolvedAdapter): Judge {
	return {
		async ask(prompt) {
			const message = { role: "user", content: prompt };
			const payload = await transport.send(
				model ? { model, messages: [message] } : { messages: [message] },
				"judge",
			);
			return parseJudgeResponse(payload);
		},
	};
}

function buildScorer({ transport, model }: ResolvedAdapter): Scorer {
	return {
		async score(text) {
			const payload = await transport.send(
				model ? { model, text } : { text },
				"scorer",
			);
			return parseScore(payload);
		},
	};
}

/** Resolve a shared transport from an adapter config, or `undefined`. */
function resolveAdapter(
	cfg: AdapterTransportConfig | undefined,
	deps: AdapterResolutionDeps,
	kind: string,
): ResolvedAdapter | undefined {
	if (!cfg || cfg.enabled === false) return undefined;

	const provider = cfg.provider ?? "http";
	const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
		return { transport: httpTransport(cfg.url, timeoutMs, fetcher), model: cfg.model };
	}

	if (provider === "command") {
		if (!cfg.command) {
			deps.logger.info(
				`adapters.${kind}: command provider requires \`command\`; adapter disabled`,
			);
			return undefined;
		}
		return { transport: commandTransport(cfg.command, timeoutMs), model: cfg.model };
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
	const resolved = resolveAdapter(cfg, deps, "embeddings");
	return resolved ? buildEmbedder(resolved) : undefined;
}

/**
 * Resolve a `Judge` from config, or `undefined` when the adapter is off or
 * unusable. Never throws.
 */
export function resolveJudge(
	cfg: JudgeAdapterConfig | undefined,
	deps: AdapterResolutionDeps,
): Judge | undefined {
	const resolved = resolveAdapter(cfg, deps, "judge");
	return resolved ? buildJudge(resolved) : undefined;
}

/**
 * Resolve a `Scorer` from config, or `undefined` when the adapter is off or
 * unusable. Never throws.
 */
export function resolveScorer(
	cfg: ScorerAdapterConfig | undefined,
	deps: AdapterResolutionDeps,
): Scorer | undefined {
	const resolved = resolveAdapter(cfg, deps, "scorer");
	return resolved ? buildScorer(resolved) : undefined;
}
