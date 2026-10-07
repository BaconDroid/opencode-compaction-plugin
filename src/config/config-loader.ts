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
export function globalConfigDir(): string {
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
			const stripped = stripTrailingCommas(stripJsonComments(raw));
			return JSON.parse(stripped) as LiveCompactionConfig;
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
function stripJsonComments(json: string): string {
	// Remove single-line comments (// ...) not inside strings
	let result = "";
	let inString = false;
	let escape = false;

	for (let i = 0; i < json.length; i++) {
		const ch = json[i];

		if (escape) {
			result += ch;
			escape = false;
			continue;
		}

		if (ch === "\\" && inString) {
			result += ch;
			escape = true;
			continue;
		}

		if (ch === '"') {
			inString = !inString;
			result += ch;
			continue;
		}

		if (inString) {
			result += ch;
			continue;
		}

		// Not in string — check for comments
		if (ch === "/" && i + 1 < json.length) {
			if (json[i + 1] === "/") {
				// Single-line comment: skip to end of line
				while (i < json.length && json[i] !== "\n") i++;
				result += "\n";
				continue;
			}
			if (json[i + 1] === "*") {
				// Block comment: skip to */
				i += 2;
				while (
					i + 1 < json.length &&
					!(json[i] === "*" && json[i + 1] === "/")
				) {
					i++;
				}
				i++; // skip the /
				continue;
			}
		}

		result += ch;
	}

	return result;
}

/** Remove trailing commas before `}` or `]`, ignoring commas inside strings. */
function stripTrailingCommas(json: string): string {
	let result = "";
	let inString = false;
	let escape = false;

	for (let i = 0; i < json.length; i++) {
		const ch = json[i];

		if (escape) {
			result += ch;
			escape = false;
			continue;
		}

		if (ch === "\\" && inString) {
			result += ch;
			escape = true;
			continue;
		}

		if (ch === '"') {
			inString = !inString;
			result += ch;
			continue;
		}

		if (inString) {
			result += ch;
			continue;
		}

		if (ch === ",") {
			let j = i + 1;
			while (j < json.length && /\s/.test(json[j])) j++;
			if (json[j] === "}" || json[j] === "]") {
				continue; // drop the trailing comma
			}
		}

		result += ch;
	}

	return result;
}
