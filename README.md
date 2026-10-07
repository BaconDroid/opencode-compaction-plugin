# opencode-live-compaction

Enhanced context compaction plugin for [OpenCode](https://opencode.ai) — structured summaries with files-touched manifests, task-state continuity, deterministic triggering, multi-scale folding, reversible compression, tool output trimming, deduplication, error purging, graduated eviction, protected file patterns, and turn protection.

## What it does

OpenCode's built-in compaction produces a 7-section summary. This plugin replaces it with an **11-section structured summary** and adds proactive context optimization strategies that reduce token usage *before* compaction triggers.

### Built-in vs opencode-live-compaction

| | OpenCode Built-in | opencode-live-compaction |
|---|---|---|
| **Summary sections** | 7 (Goal, Constraints, Progress, Decisions, Next Steps, Critical Context, Relevant Files) | **11** (Brief, User Intent Trail, Constraints, Errors/Dead Ends, Decisions, Status, Task Continuity, Open Issues, Next Steps, Mandatory Reading, Files Touched) |
| **User intent** | Captured as "Goal" | **Chronological intent trail** with direction changes |
| **Dead ends** | Not tracked | **Dedicated section** for failed approaches |
| **Task continuity** | Not captured | **Exact moment** where work stopped |
| **Files touched** | "Relevant Files" section | **Operation-badge manifest** (`R`=read, `E`=edit, `W`=write, `D`=delete) |
| **Prompt** | Hardcoded | Replaced via plugin hook (customizable) |
| **Tool output size** | Unmanaged | **Configurable per-tool trim limits** |
| **Duplicate tool calls** | Kept as-is | **Deduplicated** (keeps only latest) |
| **Errored tool calls** | Kept forever | **Whole failed attempt purged** after N turns (input + output, compact error extract kept); cascades to dependent calls |
| **Manual compaction** | `/compact` (built-in) | left to OpenCode (the plugin does not override it) |
| **Protected files** | None | **Glob patterns** (`AGENTS.md`, `**/*.config.ts`) never trimmed |
| **Recent turn protection** | None | **Last N turns** protected from trimming (default: 4) |
| **Auto-continue** | Always on | Skipped for the compaction agent and duplicate triggers |
| **Proactive compaction** | Only at the context limit | Optional **preemptive** compaction near the limit (opt-in) |
| **Prompt application** | Replaces the default | Configurable: `replace` (default) or `augment` (keep the default prompt) |
| **Post-compaction health** | None | Opt-in diagnostic for assistant messages without text |
| **Todo list** | Not managed | **Captured before compaction and restored after** (best-effort) |
| **Compress tool** | None | Model-driven **compress** tool (deterministic span selection — no indices needed) |
| **Block folding** | None | Stable `[bN]` block labels + **squash** tool to merge contiguous blocks |
| **Reversible compression** | None | **expand** (sticky) / **recall** (one-shot) restore the original messages from an in-memory sidecar |
| **Trigger threshold** | Fixed | Hybrid `min(contextLimit × ratio, absolute)`; cache tokens excluded by default |
| **Deterministic gates** | None | Optional minimum new tokens/messages since the last compaction + tail guard |
| **Graduated eviction** | None | LLM-free `reasoning → bulk output → intermediate → episode` (never evicts `user` turns) |
| **Task state** | "Goal" prose | `<task-state>` block with todo ids/statuses/priorities |
| **Focus** | None | `<latest-user-ask>` block anchored to the current user request |
| **Judge-free stop** | None | Draft-convergence detection (text distance + patience + failsafe) |

## Install

### Option 1: One-liner (curl + bash) — macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/BaconDroid/opencode-live-compaction/master/install.sh | bash
# or specify a project directory:
curl -fsSL https://raw.githubusercontent.com/BaconDroid/opencode-live-compaction/master/install.sh | bash -s /path/to/project
```

### Option 2: One-liner (PowerShell) — Windows

```powershell
irm https://raw.githubusercontent.com/BaconDroid/opencode-live-compaction/master/install.ps1 | iex
# or specify a project directory (iex does not forward parameters):
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/BaconDroid/opencode-live-compaction/master/install.ps1))) -TargetDir C:\path\to\project
```

### Option 3: npm plugin

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-live-compaction"]
}
```

> Requires the package to be published on npm. Until then, use Option 1, 2 or 4.

### Option 4: Manual

```bash
git clone https://github.com/BaconDroid/opencode-live-compaction.git
cp -r opencode-live-compaction/src/* .opencode/plugins/live-compaction/
```

## How it works

The plugin hooks into several OpenCode plugin events:

### 1. `tool.execute.after` — Files tracking

Records every file operation (read, write, edit, delete) during the session. Produces a manifest like:

```
- `src/index.ts` `R` `E`
- `src/config.ts` `R` `W`
- `test/app.test.ts` `R`
```

### 2. `experimental.chat.messages.transform` — Context optimization

Runs on every message batch sent to the LLM. Applies the following strategies in order:

1. **Pending compressions** — Applies queued `compress` calls (deterministic span selection) as `<compressed-block>` messages with stable `[bN]` labels.
2. **Squash** — Merges contiguous compressed blocks requested via the `squash` tool (fail-closed on ambiguous requests).
3. **Expand / recall** — Restores a block's original messages from the in-memory sidecar (`expand` is sticky, `recall` is one-shot).
4. **Tool output trimming** — Truncates long tool outputs (bash, read, grep, etc.) to configurable limits. Keeps the *end* of the output (usually has the result/error).
5. **Deduplication** — When the same tool is called with the same args multiple times, only the latest output is kept. Earlier duplicates are replaced with a short marker.
6. **Error purge** — Strips the whole failed attempt (input + output) from errored tool calls older than N turns, keeping a compact error extract; optionally cascades to calls that depend on the purged call.
7. **Graduated eviction** — Opt-in, LLM-free eviction (`reasoning → bulk output → intermediate → episode`) once the estimated budget is exceeded; user turns are never evicted.

### 3. `experimental.session.compacting` — Enhanced prompt

When compaction triggers (automatic or manual `/compact`), applies the enhanced 11-section template. By default (`promptMode: "replace"`) it replaces the default prompt; with `"augment"` it keeps OpenCode's default prompt and appends the template. In replace mode the previous compaction summary is fetched and re-injected as `<previous-summary>` so continuity is preserved across repeated compactions (a sliding state avoids re-emitting the same summary). The prompt also carries `<task-state>` (captured todos with ids/statuses/priorities), `<latest-user-ask>` (the current user request), and status markers (`[DONE]`, `[IN PROGRESS]`, `[TODO]`, `[BLOCKED]`, `[FAILED]`, `[UNVERIFIED]`).

1. **Brief** — Executive summary
2. **User Intent Trail** — Chronological goals with direction changes
3. **Constraints & Preferences** — User constraints and specs
4. **Errors & Dead Ends** — Failed approaches and why
5. **Key Decisions** — Decision log with rationale
6. **Status** — Done / In Progress / Blocked, tagged with status markers
7. **Task Continuity** — Exact state when compaction triggered
8. **Open Issues & Questions** — Unresolved items
9. **Next Steps** — Ordered actions to resume
10. **Mandatory Reading** — Files that must be read first
11. **Files Touched Manifest** — All files with operation badges

### 4. `experimental.compaction.autocontinue` — Auto-resume

Enables the synthetic "continue" turn after compaction, except for the compaction agent itself and duplicate triggers (a short per-session guard prevents auto-continue loops).

## Compression Tools

The plugin exposes four model-driven tools for proactive context management. The model decides when to compress and writes the summaries itself (it has full context).

### `compress`

| Parameter | Type | Description |
|---|---|---|
| `topic` | string | Short label (3-5 words) for display |
| `summary` | string | Complete technical summary replacing the range |
| `scale` | `"granular"` \| `"deep"` *(optional)* | One message vs. a whole range (default: deep) |
| `start` | number *(optional, legacy)* | Explicit start message index (inclusive, 0-based) |
| `end` | number *(optional, legacy)* | Explicit end message index (inclusive, 0-based) |

When `start`/`end` are omitted, the plugin selects the range **deterministically**: everything after the newest existing compressed block, excluding the last `compress.protectedTurns` user turns. The range is replaced with a `<compressed-block>` carrying a durable `id` and a stable `[bN]` label. The originals are kept in memory when `compress.reversible` is enabled (default).

### `squash`

Merges two or more **contiguous** compressed blocks (referenced by `[bN]` labels) into a single block: `{ from, to, topic, summary }`. Ambiguous requests (unknown labels, fewer than two blocks, non-contiguous, or more than `compress.maxBlocksPerSquash`) are refused.

### `expand` / `recall`

Restore a compressed block's original messages from the in-memory sidecar, referenced by `[bN]` label or durable id. `expand` is **sticky** (stays expanded on later turns); `recall` is **one-shot**.

All four tools are applied on the next message transform cycle.

## Protected File Patterns

Files matching glob patterns are never trimmed, even if their outputs exceed the configured limits. Useful for critical context files:

```jsonc
{
    "protectedFilePatterns": [
        "AGENTS.md",
        "**/*.config.ts",
        ".env*",
        "**/schema.prisma"
    ]
}
```

Supports: `*` (any except `/`), `**` (any including `/`), `?` (single char).

## Turn Protection

Tool outputs from recent conversation turns are protected from trimming. The last N user turns (default: 4) are never trimmed, ensuring recently-read files stay in context:

```jsonc
{
    "turnProtection": {
        "enabled": true,
        "turns": 4
    }
}
```

## Configuration

No configuration needed — the plugin works out of the box with sensible defaults. To customize, create a config file at one of:

```
.opencode/live-compaction.json          # project-local
$XDG_CONFIG_HOME/opencode/live-compaction.json   # global (~/.config/opencode/...)
```

or the same names with the `.jsonc` extension (comments and trailing commas allowed).

You can also configure the plugin inline through the `opencode.json` plugin entry:

```json
{
  "plugin": [
    ["github:BaconDroid/opencode-live-compaction", { "trim": { "bash": 1000 } }]
  ]
}
```

Precedence, low to high: **defaults → global file → plugin options → project file**.

### Default Configuration

```jsonc
{
    // Enable/disable the entire plugin
    "enabled": true,

    // Enable debug logging (logs to OpenCode's app log)
    "debug": false,

    // Tool output trim limits (max chars to keep per tool type)
    "trim": {
        "bash": 600,     // Shell outputs (logs, test runs)
        "write": 100,    // File write confirmations
        "edit": 100,     // Edit confirmations
        "delete": 50,    // Delete confirmations
        "read": 300,     // File reads
        "glob": 200,     // File listings
        "grep": 400,     // Search results
        "list": 200,     // Directory listings
        "default": 500   // Any unlisted tool
    },

    // Deduplication: remove duplicate tool calls (same tool + same args)
    "dedup": {
        "enabled": true,
        "protectedTools": []  // Tool names to exclude from dedup
    },

    // Error purge: strip the whole failed attempt (input + output) from errored calls
    "purgeErrors": {
        "enabled": true,
        "turns": 4,             // Purge errored calls older than N user turns
        "wholeAttempt": true,   // Also replace the output with a compact error extract
        "cascade": true         // Cascade the purge to calls that depend on a purged call
    },

    // Model-driven compression tools
    "compress": {
        "protectedTurns": 3,        // Trailing user turns excluded from deterministic selection
        "reversible": true,         // Keep originals in memory for expand/recall
        "maxBlocksPerSquash": 8     // Max blocks merged by a single squash
    },

    // Graduated, LLM-free eviction (opt-in)
    "eviction": {
        "enabled": false,
        "thresholdTokens": 80000,   // Eviction runs only above this estimated budget
        "levels": ["reasoning", "bulk_output", "intermediate", "episode"],
        "protectPrologue": true     // Never evict the first message
    },

    // Turn protection: protect recent tool outputs from trimming
    "turnProtection": {
        "enabled": true,
        "turns": 4   // Number of recent user turns to protect
    },

    // Proactive compaction before the context overflows (opt-in)
    "preemptiveCompaction": {
        "enabled": false,             // enable to compact before the context is full
        "threshold": 0.78,            // fraction of the context limit that triggers it
        "absoluteTokenThreshold": 0,  // optional absolute ceiling (0 = disabled); min(ratio, this) wins
        "countCacheTokens": false,    // count cache read/write tokens (off avoids premature triggers)
        "minTokensSinceLast": 0,      // gate: minimum new tokens since the last compaction
        "minMessagesSinceLast": 0,    // gate: minimum new messages since the last compaction
        "tailGuard": { "enabled": false, "minNewToolCalls": 3 },  // gate: minimum new tool calls
        "cooldownMs": 60000,          // minimum delay between proactive compactions
        "contextLimit": 200000        // optional override; else resolved from the provider
    },

    // How the compaction prompt is applied: "replace" (default) or "augment"
    // ("augment" keeps OpenCode's default prompt and appends these instructions)
    "promptMode": "replace",

    // Post-compaction diagnostic: warn when assistant messages lose text (opt-in)
    "degradationMonitor": {
        "enabled": false,
        "threshold": 4,               // consecutive assistant messages without text
        "windowMs": 120000,           // only checked within this window after compaction
        "convergenceThreshold": 0.05, // judge-free stop: converged draft distance
        "convergencePatience": 3,     // consecutive converged steps required to halt
        "maxRounds": 12               // judge-free stop: failsafe round cap
    },

    // Glob patterns for files whose outputs should never be trimmed
    "protectedFilePatterns": []
}
```

### Customizing the prompt

To customize the compaction prompt, modify the `buildCompactionPrompt()` function in `src/prompt.ts`. The template is a plain string that you can edit to add or remove sections.

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests with coverage
bun run test:coverage

# The plugin is TypeScript — no build step needed for OpenCode
# (OpenCode loads .ts files directly via Bun)
```

Current coverage: **95.9% statements, 96.2% functions, 97.7% lines, 85.2% branches** (332 tests).

## File Structure

```
src/
  index.ts          — Plugin entry point, hooks, integration
  prompt.ts         — Compaction prompt template (11 sections)
  files-touched.ts  — File operation tracker with manifest renderer
  config.ts         — Config loading and defaults
  strategies.ts     — Dedup, error purge and cascade purge strategies
  glob.ts           — Glob matcher for protected file patterns
  compress.ts       — Compress/squash tools, queue management, block rendering
  blocks.ts         — Durable block ids and deterministic span selection
  expand.ts         — Reversible sidecar + expand/recall tools
  eviction.ts       — Graduated, LLM-free eviction
  todo-preserver.ts — Todo snapshot/restore and <task-state> rendering
  preemptive-compaction.ts — Trigger threshold, gates and preemptive decision logic
  degradation-monitor.ts — Degradation diagnostic + judge-free halting rule
  previous-summary.ts — Previous summary extraction + sliding state
test/
  index.test.ts     — Plugin integration tests
  prompt.test.ts    — Prompt template tests
  files-touched.test.ts — File tracker tests
  config.test.ts    — Config loading tests
  strategies.test.ts — Strategy unit tests
  glob.test.ts      — Glob matcher tests
  compress.test.ts  — Compress/squash tool tests
  blocks.test.ts    — Block id and span selection tests
  expand.test.ts    — Reversible expand/recall tests
  eviction.test.ts  — Graduated eviction tests
  todo-preserver.test.ts — Todo preserver and task-state tests
  preemptive-compaction.test.ts — Trigger, gates and preemptive tests
  degradation-monitor.test.ts — Degradation monitor and halting tests
  previous-summary.test.ts — Previous summary and sliding-state tests
docs/
  context-compaction-research.md — Consolidated literature catalog, categories and implementation backlog
  code-review.md    — Direct source findings
  omo-compaction.md — oh-my-openagent compaction review and adopted ideas
  research-prompt.md — Reusable prompt to reproduce the literature sweep
  ensembles/        — Per-ensemble research, plans and results (E1–E5)
```

## Compatibility

- OpenCode >= 0.1.0 (with plugin support and `experimental.session.compacting` hook)
- The `experimental.*` hooks are marked experimental and may change in future OpenCode versions

### oh-my-opencode-slim

Compatible with [`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim). The two plugins register overlapping hooks but do not conflict:

- `experimental.session.compacting` — omo-slim only marks the session (it does not touch `output.prompt`/`output.context`), so this plugin's prompt handling is unaffected.
- `experimental.chat.messages.transform` — omo-slim rewrites user text and image parts; this plugin trims/dedups/purges tool parts and applies compressions. Load omo-slim **before** this plugin so its in-place rewrites run before this plugin's structural compression.
- `config` — omo-slim manages agents, MCPs and commands; this plugin only ensures permissions for its own tools (`compress`, `squash`, `expand`, `recall`) and leaves a global permission string untouched.
- No shared tool names (omo-slim: `task*`, `waitForUser`, `acpRun`, `webfetch`, `ast_grep_*`, `marketplace_*`; this plugin: `compress`, `squash`, `expand`, `recall`).
- omo-slim does not use `experimental.compaction.autocontinue` and does not mutate `permission`.

Recommended `plugin` order in `opencode.json`:

```json
{
  "plugin": ["oh-my-opencode-slim@latest", "github:BaconDroid/opencode-live-compaction"]
}
```

## License

MIT
