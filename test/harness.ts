/**
 * Test harness for the OpenCode 2 plugin contract.
 *
 * Builds a mock `setup(ctx)` context that captures the hooks, transforms and
 * tools the plugin registers, and exposes helpers to drive them the way the
 * 2.0 host does (one mutable event per hook, `id`/`input` on tool events,
 * async event subscription).
 */

import { CompactionPlugin } from "../src/index.ts";

export interface Harness {
	hooks: Record<string, Array<(event: any) => unknown>>;
	tools: any[];
	cleanup: (() => unknown) | undefined;
	ctx: any;
	/** Deliver an event to the plugin's `ctx.event.subscribe` loop. */
	emit(event: any): Promise<void>;
}

const settle = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 5));
};

export async function setupPlugin(
	directory: string,
	options?: unknown,
	overrides: Record<string, any> = {},
): Promise<Harness> {
	const hooks: Record<string, Array<(event: any) => unknown>> = {};
	const tools: any[] = [];
	const queue: any[] = [];
	let waiting: ((result: IteratorResult<any>) => void) | undefined;

	const subscribe = (opts?: { signal?: AbortSignal }) => ({
		[Symbol.asyncIterator]() {
			return {
				next() {
					if (queue.length > 0) {
						return Promise.resolve({ value: queue.shift(), done: false });
					}
					return new Promise<IteratorResult<any>>((resolve) => {
						waiting = resolve;
						opts?.signal?.addEventListener(
							"abort",
							() => resolve({ value: undefined, done: true }),
							{ once: true },
						);
					});
				},
				async return() {
					return { value: undefined, done: true };
				},
			};
		},
	});

	const ctx: any = {
		app: { name: "test", version: "2.0.30", channel: "test" },
		location: {
			directory,
			project: { id: "test-project", directory, canonical: directory },
		},
		options,
		session: {
			hook: async (name: string, callback: (event: any) => unknown) => {
				(hooks[name] ??= []).push(callback);
				return { dispose: async () => {} };
			},
			context: async () => [],
		},
		tool: {
			hook: async (name: string, callback: (event: any) => unknown) => {
				(hooks[name] ??= []).push(callback);
				return { dispose: async () => {} };
			},
			transform: async (callback: (editor: any) => void) => {
				callback({
					add: (tool: any) => tools.push(tool),
					update: () => {},
					remove: () => {},
					list: () => tools,
					get: () => undefined,
					namespace: () => {},
				});
				return { dispose: async () => {} };
			},
		},
		event: { subscribe },
		generate: { text: async () => ({ text: "" }) },
		storage: {
			get: async () => undefined,
			set: async () => {},
			remove: async () => {},
		},
	};

	for (const [key, value] of Object.entries(overrides)) {
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			ctx[key] &&
			typeof ctx[key] === "object"
		) {
			Object.assign(ctx[key], value);
		} else {
			ctx[key] = value;
		}
	}

	const cleanup = await CompactionPlugin.setup(ctx);
	await settle();

	const emit = async (event: any) => {
		if (waiting) {
			const resolve = waiting;
			waiting = undefined;
			resolve({ value: event, done: false });
		} else {
			queue.push(event);
		}
		await settle();
	};

	return { hooks, tools, cleanup: cleanup as any, ctx, emit };
}

/** Invoke every callback registered for a hook name. */
export async function callHook(
	harness: Harness,
	name: string,
	event: any,
): Promise<any> {
	for (const callback of harness.hooks[name] ?? []) await callback(event);
	return event;
}

/** A `compaction` event skeleton matching the 2.0 session hook payload. */
export function compactionEvent(sessionID: string): any {
	return {
		sessionID,
		agent: "build",
		model: { providerID: "opencode", id: "test-model" },
		system: [] as Array<{ type: "text"; text: string }>,
		messages: [] as unknown[],
		options: {},
		tools: {},
	};
}

/** A `context` (messages transform) event skeleton. */
export function contextEvent(sessionID: string, messages: unknown): any {
	return {
		sessionID,
		agent: "build",
		model: { providerID: "opencode", id: "test-model" },
		system: [] as Array<{ type: "text"; text: string }>,
		messages,
		options: {},
		tools: {},
	};
}
