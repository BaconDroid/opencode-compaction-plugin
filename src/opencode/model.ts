/**
 * The opencode-model runtime for the optional `scorer` adapter. It
 * consumes a model already configured in opencode through a sandboxed session
 * (no provider/auth handling here — keys and endpoints stay in opencode), like
 * the LLM judge pattern used elsewhere. Fail-open: any error yields "".
 */

/** Free OpenCode Zen model, used when an adapter does not name one. */
export const DEFAULT_ADAPTER_MODEL = "opencode/big-pickle";

/** Sentinel: reuse the model opencode is already configured with. */
export const HOST_MODEL = "host";

const DEFAULT_TIMEOUT_MS = 30_000;
const SANDBOX_TITLE = "compaction adapter";

/**
 * Split a `provider/model` string into its parts. `"host"` (or an unset value)
 * returns `undefined` so no model is sent and opencode keeps its active model.
 */
export function resolveModelRef(
	model: string | undefined,
): { providerID: string; modelID: string } | undefined {
	if (model === undefined || model === HOST_MODEL) return undefined;
	const separator = model.indexOf("/");
	if (separator <= 0 || separator === model.length - 1) return undefined;
	return {
		providerID: model.slice(0, separator),
		modelID: model.slice(separator + 1),
	};
}

export interface ModelCallOptions {
	/** System prompt for the sandboxed call. */
	system?: string;
	/** Raw `provider/model` string (default `opencode/big-pickle`); "host" uses the host model. */
	model?: string;
	/** Request timeout in ms (default 30000). */
	timeoutMs?: number;
}

/** A single-shot model call returning the concatenated text parts. */
export type ModelRunner = (
	prompt: string,
	options?: ModelCallOptions,
) => Promise<string>;

interface SessionLike {
	create?: (options: unknown) => Promise<{ data?: { id?: string } }>;
	prompt?: (options: unknown) => Promise<{
		data?: { parts?: Array<{ type?: string; text?: string }> };
	}>;
	delete?: (options: unknown) => Promise<unknown>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("model call timed out")), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * Build a runner backed by the opencode SDK client. The client is typed loosely
 * and every step is fail-open: a missing method or error yields "". A
 * re-entrancy guard prevents a nested call (the sandbox session would otherwise
 * re-enter this plugin's transform and recurse).
 */
export function createModelRunner(client: unknown, directory: string): ModelRunner {
	const session = (client as { session?: SessionLike } | undefined)?.session;
	let active = 0;

	return async (prompt, options = {}) => {
		if (!session?.create || !session?.prompt) return "";
		if (active > 0) return "";
		active++;
		try {
			const created = await session.create({
				body: { title: SANDBOX_TITLE },
				query: { directory },
			});
			const id = created?.data?.id;
			if (!id) return "";
			try {
				const modelRef = resolveModelRef(options.model ?? DEFAULT_ADAPTER_MODEL);
				const result = await withTimeout(
					session.prompt({
						path: { id },
						query: { directory },
						body: {
							system: options.system,
							tools: {
								bash: false,
								edit: false,
								write: false,
								read: false,
								webfetch: false,
								patch: false,
								task: false,
							},
							...(modelRef ? { model: modelRef } : {}),
							parts: [{ type: "text", text: prompt }],
						},
					}),
					options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				);
				const parts = result?.data?.parts ?? [];
				return parts
					.filter((part) => part.type === "text" && typeof part.text === "string")
					.map((part) => part.text!)
					.join("\n");
			} finally {
				try {
					await session.delete?.({ path: { id }, query: { directory } });
				} catch {
					// deleting the sandbox session is best-effort
				}
			}
		} catch {
			return "";
		} finally {
			active--;
		}
	};
}
