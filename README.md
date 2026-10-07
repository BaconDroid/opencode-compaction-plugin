# opencode-live-compaction

Enhanced context compaction plugin for [OpenCode](https://opencode.ai) — structured summaries with files-touched manifests, task-state continuity, tool output trimming, deduplication, error purging, protected file patterns, turn protection, compress tool, and slash commands.

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
| **Errored tool inputs** | Kept forever | **Purged** after N turns (error output preserved) |
| **Manual compaction** | `/compact` only | built-in `/compact`, plus `/compact focus <goal>` to set a focus |
| **Protected files** | None | **Glob patterns** (`AGENTS.md`, `**/*.config.ts`) never trimmed |
| **Recent turn protection** | None | **Last N turns** protected from trimming (default: 4) |
| **Auto-continue** | Always on | Skipped for the compaction agent and duplicate triggers |
| **Proactive compaction** | Only at the context limit | Optional **preemptive** compaction near the limit (opt-in) |
| **Prompt application** | Replaces the default | Configurable: `replace` (default) or `augment` (keep the default prompt) |
| **Post-compaction health** | None | Opt-in diagnostic for assistant messages without text |
| **Todo list** | Not managed | **Captured before compaction and restored after** (best-effort) |
| **Compress tool** | None | Model-driven **compress** tool for proactive context management |

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

Runs on every message batch sent to the LLM. Applies three strategies in order:

1. **Tool output trimming** — Truncates long tool outputs (bash, read, grep, etc.) to configurable limits. Keeps the *end* of the output (usually has the result/error).
2. **Deduplication** — When the same tool is called with the same args multiple times, only the latest output is kept. Earlier duplicates are replaced with a short marker.
3. **Error input purging** — Strips the large input content from errored tool calls (the error message is preserved).

### 3. `experimental.session.compacting` — Enhanced prompt

When compaction triggers (automatic or manual `/compact`), applies the enhanced 11-section template. By default (`promptMode: "replace"`) it replaces the default prompt; with `"augment"` it keeps OpenCode's default prompt and appends the template. In replace mode the previous compaction summary is fetched and re-injected as `<previous-summary>` so continuity is preserved across repeated compactions.

1. **Brief** — Executive summary
2. **User Intent Trail** — Chronological goals with direction changes
3. **Constraints & Preferences** — User constraints and specs
4. **Errors & Dead Ends** — Failed approaches and why
5. **Key Decisions** — Decision log with rationale
6. **Status** — Done / In Progress / Blocked
7. **Task Continuity** — Exact state when compaction triggered
8. **Open Issues & Questions** — Unresolved items
9. **Next Steps** — Ordered actions to resume
10. **Mandatory Reading** — Files that must be read first
11. **Files Touched Manifest** — All files with operation badges

### 4. `experimental.compaction.autocontinue` — Auto-resume

Enables the synthetic "continue" turn after compaction, except for the compaction agent itself and duplicate triggers (a short per-session guard prevents auto-continue loops).

## Slash Commands

`/compact` is OpenCode's built-in compaction command (alias `/summarize`); the plugin does not override it. To set a focus directive, pass an extra argument:

```
/compact focus Fix the authentication bug in login.ts
```

The plugin's `command.execute.before` hook reads the extra argument and injects a `<focus-directive>` block into the next compaction prompt, so the summary preserves context relevant to that goal. This is best-effort: it depends on the built-in command forwarding its arguments to the hook.

## Compress Tool

The plugin exposes a `compress` tool to the model, enabling proactive context management. The model decides when to compress and writes the summary itself (it has full context).

| Parameter | Type | Description |
|---|---|---|
| `topic` | string | Short label (3-5 words) for display |
| `start` | number | Start message index (inclusive, 0-based) |
| `end` | number | End message index (inclusive, 0-based) |
| `summary` | string | Complete technical summary replacing the range |

When the model calls `compress`, the specified message range is replaced with a `<compressed-block>` containing the summary. This happens on the next message transform cycle.

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

    // Error input purging: strip inputs from errored tool calls
    "purgeErrors": {
        "enabled": true,
        "turns": 4  // Purge errored tool inputs older than N user turns
    },

    // Slash commands
    "commands": {
        "enabled": true
    },

    // Turn protection: protect recent tool outputs from trimming
    "turnProtection": {
        "enabled": true,
        "turns": 4   // Number of recent user turns to protect
    },

    // Proactive compaction before the context overflows (opt-in)
    "preemptiveCompaction": {
        "enabled": false,        // enable to compact before the context is full
        "threshold": 0.78,       // fraction of the context limit that triggers it
        "cooldownMs": 60000,     // minimum delay between proactive compactions
        "contextLimit": 200000   // optional override; else resolved from the provider
    },

    // How the compaction prompt is applied: "replace" (default) or "augment"
    // ("augment" keeps OpenCode's default prompt and appends these instructions)
    "promptMode": "replace",

    // Post-compaction diagnostic: warn when assistant messages lose text (opt-in)
    "degradationMonitor": {
        "enabled": false,
        "threshold": 4,          // consecutive assistant messages without text
        "windowMs": 120000       // only checked within this window after compaction
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

Current coverage: **95.4% statements, 96.6% functions, 97.2% lines, 87.0% branches** (233 tests).

## File Structure

```
src/
  index.ts          — Plugin entry point, hooks, integration
  prompt.ts         — Compaction prompt template (11 sections)
  files-touched.ts  — File operation tracker with manifest renderer
  config.ts         — Config loading and defaults
  strategies.ts     — Dedup and error purge strategies
  glob.ts           — Glob matcher for protected file patterns
  compress.ts       — Compress tool definition and queue management
  todo-preserver.ts — Todo snapshot/restore around compaction
  preemptive-compaction.ts — Proactive compaction decision logic
  degradation-monitor.ts — Post-compaction degradation diagnostic
  previous-summary.ts — Previous compaction summary extraction
test/
  index.test.ts     — Plugin integration tests
  prompt.test.ts    — Prompt template tests
  files-touched.test.ts — File tracker tests
  config.test.ts    — Config loading tests
  strategies.test.ts — Strategy unit tests
  glob.test.ts      — Glob matcher tests
  compress.test.ts  — Compress tool tests
  todo-preserver.test.ts — Todo preserver tests
  preemptive-compaction.test.ts — Preemptive compaction tests
  degradation-monitor.test.ts — Degradation monitor tests
  previous-summary.test.ts — Previous summary tests
docs/
  context-compaction-research.md — Literature catalog and implementation backlog
  code-review.md    — Direct source findings
  omo-compaction.md — oh-my-openagent compaction review and adopted ideas
```

## Compatibility

- OpenCode >= 0.1.0 (with plugin support and `experimental.session.compacting` hook)
- The `experimental.*` hooks are marked experimental and may change in future OpenCode versions

## License

MIT
