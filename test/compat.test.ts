import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { LiveCompactionPlugin } from "../src/index.ts";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// Compatibility contract with `oh-my-opencode-slim` (see README "Compatibility").
// These are executable guards against regressions in the shared surface:
//   - tool names must not collide with omo-slim's documented tools;
//   - only the documented hooks are registered;
//   - the config hook never clobbers a global permission string.

const TMP_DIR = join(import.meta.dirname, "__tmp_compat_test");
const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;

const PLUGIN_TOOLS = [
	"compress",
	"squash",
	"expand",
	"recall",
	"inspect",
	"search",
];

// Documented omo-slim tool names/prefixes.
const OMO_SLIM_PREFIXES = ["task", "ast_grep_", "marketplace_"];
const OMO_SLIM_EXACT = ["waitForUser", "acpRun", "webfetch"];

const EXPECTED_HOOKS = [
	"dispose",
	"event",
	"tool.execute.after",
	"experimental.session.compacting",
	"experimental.compaction.autocontinue",
	"experimental.chat.messages.transform",
	"config",
	"tool",
];

function setupTmp() {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
	mkdirSync(TMP_DIR, { recursive: true });
	mkdirSync(join(TMP_DIR, "xdg"), { recursive: true });
	process.env.XDG_CONFIG_HOME = join(TMP_DIR, "xdg");
}

function cleanupTmp() {
	if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

const mockCtx = {
	client: { app: { log: mock().mockResolvedValue(undefined) } },
	project: { id: "test-project", name: "test" },
	directory: TMP_DIR,
	worktree: TMP_DIR,
	serverUrl: new URL("http://localhost:4096"),
};

describe("omo-slim compatibility contract", () => {
	beforeEach(setupTmp);
	afterEach(cleanupTmp);

	it("registers no tool name that collides with omo-slim", () => {
		for (const name of PLUGIN_TOOLS) {
			expect(OMO_SLIM_EXACT).not.toContain(name);
			for (const prefix of OMO_SLIM_PREFIXES) {
				expect(name.startsWith(prefix)).toBe(false);
			}
		}
	});

	it("exposes exactly the documented model-driven tools", async () => {
		const hooks = await LiveCompactionPlugin(mockCtx as any);
		expect(Object.keys((hooks as any).tool ?? {}).sort()).toEqual(
			[...PLUGIN_TOOLS].sort(),
		);
	});

	it("registers only the documented hooks", async () => {
		const hooks = await LiveCompactionPlugin(mockCtx as any);
		expect(Object.keys(hooks).sort()).toEqual([...EXPECTED_HOOKS].sort());
	});

	it("never clobbers a global permission string", async () => {
		const hooks = await LiveCompactionPlugin(mockCtx as any);
		const opencodeConfig: Record<string, unknown> = { permission: "allow" };
		await (hooks as any).config(opencodeConfig);
		expect(opencodeConfig.permission).toBe("allow");
	});
});
