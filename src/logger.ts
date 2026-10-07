/** Minimal debug logger writing to OpenCode's app log. */

import type { PluginInput } from "./types.js";

export interface Logger {
	info: (message: string, data?: unknown) => void;
}

export function makeLogger(
	client: PluginInput["client"],
	enabled: boolean,
): Logger {
	return {
		info: (message: string, data?: unknown) => {
			if (!enabled) return;
			client.app.log({
				body: {
					service: "live-compaction",
					level: "info",
					message,
					extra: data as Record<string, unknown> | undefined,
				},
			});
		},
	};
}
