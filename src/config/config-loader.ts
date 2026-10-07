/**
 * Loads opencode-live-compaction config from JSON/JSONC files.
 *
 * Precedence, low to high:
 *   defaults < global config file < plugin options < project-local config file.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
	deepMerge,
	mergeConfig,
	type LiveCompactionConfig,
	type ResolvedConfig,
} from "./config.js";

const CONFIG_FILE_NAMES = ["live-compaction.json", "live-compaction.jsonc"];

/**
 * Directory of the global OpenCode config. Uses `XDG_CONFIG_HOME` when set
 * (which also covers the Flatpak layout) and falls back to `~/.config`.
 */
function globalConfigDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg && xdg.trim() ? xdg : join(homedir(), ".config");
	return join(base, "opencode");
}

function readConfigDir(
	dir: string,
	onError?: (message: string, error?: unknown) => void,
): LiveCompactionConfig | undefined {
	for (const name of CONFIG_FILE_NAMES) {
		const configPath = join(dir, name);
		if (!existsSync(configPath)) continue;
		try {
			const raw = readFileSync(configPath, "utf-8");
			return JSON.parse(stripJsonc(raw)) as LiveCompactionConfig;
		} catch (error) {
			onError?.(`failed to parse ${configPath}`, error);
		}
	}
	return undefined;
}

export function loadConfig(
	projectDir: string,
	onError?: (message: string, error?: unknown) => void,
	overrides?: LiveCompactionConfig,
): ResolvedConfig {
	let user: LiveCompactionConfig = {};

	const globalConfig = readConfigDir(globalConfigDir(), onError);
	if (globalConfig) user = deepMerge(user, globalConfig);

	if (overrides) user = deepMerge(user, overrides);

	const projectConfig = readConfigDir(join(projectDir, ".opencode"), onError);
	if (projectConfig) user = deepMerge(user, projectConfig);

	return mergeConfig(user);
}

/** Strip single-line and block comments from JSONC strings. */
/**
 * Strip JSONC comments (`//`, `/* *​/`) and trailing commas before `}`/`]` in a
 * single pass, ignoring both inside strings.
 */
function stripJsonc(json: string): string {
	let result = "";
	let inString = false;
	let escape = false;
	let i = 0;

	while (i < json.length) {
		const ch = json[i];

		if (escape) {
			result += ch;
			escape = false;
			i++;
			continue;
		}
		if (ch === "\\" && inString) {
			result += ch;
			escape = true;
			i++;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			result += ch;
			i++;
			continue;
		}
		if (inString) {
			result += ch;
			i++;
			continue;
		}

		// Single-line comment: skip to end of line.
		if (ch === "/" && json[i + 1] === "/") {
			while (i < json.length && json[i] !== "\n") i++;
			result += "\n";
			if (i < json.length) i++;
			continue;
		}
		// Block comment: skip to the closing */.
		if (ch === "/" && json[i + 1] === "*") {
			i += 2;
			while (i + 1 < json.length && !(json[i] === "*" && json[i + 1] === "/")) {
				i++;
			}
			i += 2;
			continue;
		}
		// Trailing comma before } or ].
		if (ch === ",") {
			let j = i + 1;
			while (j < json.length && /\s/.test(json[j])) j++;
			if (json[j] === "}" || json[j] === "]") {
				i++;
				continue;
			}
		}

		result += ch;
		i++;
	}

	return result;
}
