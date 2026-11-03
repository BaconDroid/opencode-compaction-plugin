import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { setupPlugin } from "./harness.ts";
import { makeTmpSetup } from "./helpers.ts";
import { join } from "node:path";

// Compatibility contract with `oh-my-opencode-slim` (see README "Compatibility").
// These are executable guards against regressions in the shared surface:
//   - tool names must not collide with omo-slim's documented tools;
//   - only the documented hooks are registered.

const TMP_DIR = join(import.meta.dirname, "__tmp_compat_test");

const PLUGIN_TOOLS = [
	"compress",
];

// Documented omo-slim tool names/prefixes.
const OMO_SLIM_PREFIXES = ["task", "ast_grep_", "marketplace_"];
const OMO_SLIM_EXACT = ["waitForUser", "acpRun", "webfetch"];

// OpenCode 2 registrations the equivalent V1 hooks map onto:
//   tool.execute.after                      -> tool  "execute.after"
//   experimental.session.compacting         -> session "compaction"
//   experimental.chat.messages.transform    -> session "context"
// (`experimental.compaction.autocontinue` and `config` have no 2.0 registration.)
const EXPECTED_HOOKS = [
	"execute.after",
	"compaction",
	"context",
];

const { setup: setupTmp, cleanup: cleanupTmp } = makeTmpSetup(TMP_DIR);

describe("omo-slim compatibility contract", () => {
	beforeEach(setupTmp);
	afterEach(cleanupTmp);

	it("exposes exactly the documented model-driven tools, none colliding with omo-slim", async () => {
		const harness = await setupPlugin(TMP_DIR);
		const names = harness.tools.map((tool) => tool.name).sort();
		expect(names).toEqual([...PLUGIN_TOOLS].sort());
		for (const name of names) {
			expect(OMO_SLIM_EXACT).not.toContain(name);
			for (const prefix of OMO_SLIM_PREFIXES) {
				expect(name.startsWith(prefix)).toBe(false);
			}
		}
	});

	it("registers only the documented hooks", async () => {
		const harness = await setupPlugin(TMP_DIR);
		expect(Object.keys(harness.hooks).sort()).toEqual([...EXPECTED_HOOKS].sort());
	});
});
