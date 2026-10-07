/**
 * Provider implementations for the optional external adapters (the SDK/OS
 * boundary). This module turns config into concrete `Embedder`/`VectorIndex`
 * objects; the pure contracts live in `../core/adapters.ts`.
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
import type { Embedder } from "../core/adapters.js";
import type { EmbeddingsAdapterConfig } from "../config/config.js";
import type { Logger } from "../types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface AdapterResolutionDeps {
	logger: Logger;
	/** Injectable fetch for tests (defaults to the platform fetch). */
	fetcher?: typeof fetch;
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

function requestBody(
	model: string | undefined,
	texts: string[],
): string {
	return JSON.stringify(model ? { model, input: texts } : { input: texts });
}

/** HTTP provider: POST an OpenAI-style embeddings request to `url`. */
function httpEmbedder(
	url: string,
	model: string | undefined,
	timeoutMs: number,
	fetcher: typeof fetch,
): Embedder {
	return {
		async embed(texts) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetcher(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: requestBody(model, texts),
					signal: controller.signal,
				});
				if (!response.ok) {
					throw new Error(
						`embedding endpoint returned HTTP ${response.status}`,
					);
				}
				return parseEmbeddings(await response.json(), texts.length);
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/**
 * Command provider: spawn `command`, write `{model,input}` JSON on stdin and
 * read an embeddings JSON document on stdout. Non-interactive (stdin is closed
 * after the write) and killed on timeout.
 */
function commandEmbedder(
	command: string,
	model: string | undefined,
	timeoutMs: number,
): Embedder {
	return {
		embed(texts) {
			return new Promise<number[][]>((resolve, reject) => {
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
					finish(() => reject(new Error("embedding command timed out")));
				}, timeoutMs);

				child.stdout?.on("data", (chunk) => {
					stdout += String(chunk);
				});
				child.on("error", (error) => finish(() => reject(error)));
				child.on("close", (code) => {
					if (code !== 0) {
						finish(() =>
							reject(new Error(`embedding command exited with code ${code}`)),
						);
						return;
					}
					finish(() => {
						try {
							resolve(parseEmbeddings(JSON.parse(stdout), texts.length));
						} catch (error) {
							reject(error);
						}
					});
				});
				child.stdin?.on("error", (error) => finish(() => reject(error)));
				child.stdin?.end(requestBody(model, texts));
			});
		},
	};
}

/**
 * Resolve an `Embedder` from config, or `undefined` when the adapter is off or
 * unusable. Never throws.
 */
export function resolveEmbedder(
	cfg: EmbeddingsAdapterConfig | undefined,
	deps: AdapterResolutionDeps,
): Embedder | undefined {
	if (!cfg || cfg.enabled === false) return undefined;

	const provider = cfg.provider ?? "http";

	if (provider === "http") {
		if (!cfg.url) {
			deps.logger.info(
				"adapters.embeddings: http provider requires `url`; adapter disabled",
			);
			return undefined;
		}
		const fetcher =
			deps.fetcher ??
			((input: string | URL | Request, init?: RequestInit) =>
				globalThis.fetch(input, init));
		if (typeof fetcher !== "function") {
			deps.logger.info(
				"adapters.embeddings: no fetch available; adapter disabled",
			);
			return undefined;
		}
		return httpEmbedder(
			cfg.url,
			cfg.model,
			cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			fetcher,
		);
	}

	if (provider === "command") {
		if (!cfg.command) {
			deps.logger.info(
				"adapters.embeddings: command provider requires `command`; adapter disabled",
			);
			return undefined;
		}
		return commandEmbedder(
			cfg.command,
			cfg.model,
			cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
	}

	if (provider === "mcp") {
		deps.logger.info(
			"adapters.embeddings: mcp provider is not supported; using keyword search",
		);
		return undefined;
	}

	deps.logger.info(
		`adapters.embeddings: unknown provider "${String(provider)}"; adapter disabled`,
	);
	return undefined;
}
