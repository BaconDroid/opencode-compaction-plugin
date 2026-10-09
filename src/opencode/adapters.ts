/**
 * Provider implementations for the optional external adapter (the SDK/OS
 * boundary). This module turns config into a concrete `Scorer`; the pure
 * contract lives in `../core/adapters.ts`.
 *
 * The scorer shares one transport abstraction: an `http` POST or a spawned
 * `command` that reads a JSON payload on stdin. The `opencode` provider reuses
 * a model already configured in opencode through a sandboxed session. No
 * dependency is added (platform `fetch` + `node:child_process`). Resolution
 * never throws — when a provider is unusable (missing field, unsupported
 * transport) `undefined` is returned and the caller keeps its deterministic
 * fallback; runtime errors are caught by the caller (fail-open).
 *
 * Secrets: URLs and commands are user-supplied and are never logged; only the
 * provider name and the reason for disabling are.
 */

import { spawn } from "node:child_process";
import type { Scorer } from "../core/adapters.js";
import type {
	AdapterTransportConfig,
	ScorerAdapterConfig,
} from "../config/config.js";
import type { Logger } from "../types.js";
import {
	DEFAULT_ADAPTER_MODEL,
	HOST_MODEL,
	createModelRunner,
	resolveModelRef,
	type ModelRunner,
} from "./model.js";

const DEFAULT_TIMEOUT_MS = 10_000;
/** Default timeout for a model-backed adapter call (models are slower). */
const DEFAULT_MODEL_TIMEOUT_MS = 30_000;
/** Cap on command stdout, to bound memory for a misbehaving command. */
const MAX_COMMAND_STDOUT = 8 * 1024 * 1024;

export interface AdapterResolutionDeps {
	logger: Logger;
	/** Injectable fetch for tests (defaults to the platform fetch). */
	fetcher?: typeof fetch;
	/** opencode SDK client (required by the "opencode" provider). */
	client?: unknown;
	/** Workspace directory passed to sandboxed model calls. */
	directory?: string;
	/** Injectable model runner for tests (defaults to one built from `client`). */
	modelRunner?: ModelRunner;
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
 * Normalise the common scorer response shapes into a number. Accepts a bare
 * number, a numeric string, `{ score }`/`{ value }`/`{ tokens }`/`{ residual }`
 * or `{ data: [ … ] }`.
 */
export function parseScore(payload: unknown): number {
	if (typeof payload === "number" && Number.isFinite(payload)) return payload;
	// Reject empty/whitespace strings: `Number("")` is 0, which would silently
	// report a residual of zero tokens.
	if (typeof payload === "string" && payload.trim() !== "") {
		const n = Number(payload.trim());
		if (Number.isFinite(n)) return n;
	}
	if (payload && typeof payload === "object") {
		const obj = payload as Record<string, unknown>;
		for (const key of ["score", "value", "tokens", "residual"]) {
			const value = obj[key];
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value === "string" && value.trim() !== "") {
				const n = Number(value);
				if (Number.isFinite(n)) return n;
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
			if (stdout.length > MAX_COMMAND_STDOUT) {
				child.kill("SIGKILL");
				finish(() =>
					reject(new Error(`${label} command produced too much output`)),
				);
			}
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
		child.stdin?.on("error", (error) => {
			// Kill the child so a command that closed stdin early cannot leak.
			child.kill("SIGKILL");
			finish(() => reject(error));
		});
		child.stdin?.end(body);
	});
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

/**
 * Resolve the shared model runner, or `undefined` when no client is available.
 * A caller-supplied runner (tests) wins.
 */
function resolveModelRunner(deps: AdapterResolutionDeps): ModelRunner | undefined {
	if (deps.modelRunner) return deps.modelRunner;
	if (deps.client === undefined || deps.directory === undefined) return undefined;
	return createModelRunner(deps.client, deps.directory);
}

/** Warn when an explicit model string is neither "host" nor a valid ref. */
function warnOnBadModel(
	model: string | undefined,
	deps: AdapterResolutionDeps,
	kind: string,
): void {
	if (model === undefined || model === HOST_MODEL) return;
	if (resolveModelRef(model) === undefined) {
		deps.logger.warn(
			`adapters.${kind}: model "${model}" is not provider/model; using the host model`,
		);
	}
}

const SCORER_SYSTEM =
	"You estimate token counts. Reply with JSON only. Do not call any tool.";

/** Extract the first JSON array from a model reply, or throw. */
function parseJsonArray(raw: string, label: string): unknown[] {
	const start = raw.indexOf("[");
	const end = raw.lastIndexOf("]");
	if (start < 0 || end <= start) {
		throw new Error(`${label} response has no JSON array`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.slice(start, end + 1));
	} catch {
		throw new Error(`${label} response is not valid JSON`);
	}
	if (!Array.isArray(parsed)) throw new Error(`${label} response is not an array`);
	return parsed;
}

/**
 * Normalise a scorer reply into one estimate per text, in order. A missing or
 * mis-sized array throws; a non-numeric entry yields `NaN` so the estimator
 * keeps the heuristic for that text.
 */
function parseTokenEstimates(raw: string, expected: number): number[] {
	const parsed = parseJsonArray(raw, "scorer");
	if (parsed.length !== expected) {
		throw new Error(
			`scorer returned ${parsed.length} estimates for ${expected} texts`,
		);
	}
	return parsed.map((value) => {
		if (typeof value === "number") return value;
		if (typeof value === "string" && value.trim() !== "") return Number(value);
		return Number.NaN;
	});
}

/** Bound on the model scorer's text→estimate cache (insertion-order eviction). */
const MODEL_SCORE_CACHE_MAX = 1000;

/**
 * A `Scorer` backed by the opencode model runner. It never blocks the transform:
 * `scoreMany` returns the estimates already cached and warms the rest in the
 * background (one call at a time), so a slow or broken model only delays scores
 * to a later transform. Fail-open: errors leave texts unscored (heuristic).
 */
function buildModelScorer(runner: ModelRunner, cfg: ScorerAdapterConfig): Scorer {
	const model = cfg.model ?? DEFAULT_ADAPTER_MODEL;
	const timeoutMs = cfg.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
	const cache = new Map<string, number>();
	let inFlight = false;

	const fill = async (texts: string[]): Promise<void> => {
		inFlight = true;
		try {
			const prompt = [
				"Estimate the number of LLM tokens (contiguous BPE tokens) each text below would consume.",
				`Return ONLY a JSON array of ${texts.length} integers, one per text, in the same order.`,
				JSON.stringify(texts),
			].join("\n\n");
			const raw = await runner(prompt, { system: SCORER_SYSTEM, model, timeoutMs });
			const values = parseTokenEstimates(raw, texts.length);
			texts.forEach((text, index) => {
				const value = values[index];
				if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
					cache.set(text, value);
				}
			});
			while (cache.size > MODEL_SCORE_CACHE_MAX) {
				const oldest = cache.keys().next().value;
				if (oldest === undefined) break;
				cache.delete(oldest);
			}
		} catch {
			// fail-open: leave uncached so a later transform retries
		} finally {
			inFlight = false;
		}
	};

	const scoreMany = async (texts: string[]): Promise<number[]> => {
		if (texts.length === 0) return [];
		const missing = texts.filter((text) => !cache.has(text));
		if (missing.length > 0 && !inFlight) {
			void fill(missing).catch(() => {});
		}
		return texts.map((text) => cache.get(text) ?? Number.NaN);
	};

	return {
		async score(text) {
			const [value] = await scoreMany([text]);
			return value;
		},
		scoreMany,
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
			deps.logger.warn(
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
			deps.logger.warn(
				`adapters.${kind}: command provider requires \`command\`; adapter disabled`,
			);
			return undefined;
		}
		return { transport: commandTransport(cfg.command, timeoutMs), model: cfg.model };
	}

	if (provider === "mcp") {
		deps.logger.warn(
			`adapters.${kind}: mcp provider is not supported; fallback in use`,
		);
		return undefined;
	}

	deps.logger.warn(
		`adapters.${kind}: unknown provider "${String(provider)}"; adapter disabled`,
	);
	return undefined;
}

/**
 * Resolve a `Scorer` from config, or `undefined` when the adapter is off or
 * unusable. Never throws. Provider "opencode" reuses a model configured in
 * opencode (default `opencode/big-pickle`; "host" reuses the active model).
 */
export function resolveScorer(
	cfg: ScorerAdapterConfig | undefined,
	deps: AdapterResolutionDeps,
): Scorer | undefined {
	if (!cfg || cfg.enabled === false) return undefined;
	if ((cfg.provider ?? "http") === "opencode") {
		const runner = resolveModelRunner(deps);
		if (!runner) {
			deps.logger.warn(
				"adapters.scorer: opencode provider requires an SDK client; adapter disabled",
			);
			return undefined;
		}
		warnOnBadModel(cfg.model, deps, "scorer");
		return buildModelScorer(runner, cfg);
	}
	const resolved = resolveAdapter(cfg, deps, "scorer");
	return resolved ? buildScorer(resolved) : undefined;
}
