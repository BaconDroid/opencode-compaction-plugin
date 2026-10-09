# opencode-compaction-plugin

Enhanced context compaction plugin for [OpenCode](https://opencode.ai) — structured summaries with files-touched manifests, deterministic triggering, model-driven folding, deduplication, error purging, and graduated eviction.

## What it does

OpenCode's built-in compaction produces a 7-section summary. This plugin replaces it with an **11-section structured summary** and adds proactive context optimization strategies that reduce token usage *before* compaction triggers.

### Built-in vs opencode-compaction-plugin

| | OpenCode Built-in | opencode-compaction-plugin |
|---|---|---|
| **Summary sections** | 7 (Goal, Constraints, Progress, Decisions, Next Steps, Critical Context, Relevant Files) | **11** (Brief, User Intent Trail, Constraints, Errors/Dead Ends, Decisions, Status, Task Continuity, Open Issues, Next Steps, Mandatory Reading, Files Touched) |
| **User intent** | Captured as "Goal" | **Chronological intent trail** with direction changes |
| **Dead ends** | Not tracked | **Dedicated section** for failed approaches |
| **Task continuity** | Not captured | **Exact moment** where work stopped |
| **Files touched** | "Relevant Files" section | **Operation-badge manifest** (`R`=read, `E`=edit, `W`=write, `D`=delete) from structured file tools |
| **Prompt** | Hardcoded | Replaced via plugin hook (customizable) |
| **Duplicate tool calls** | Kept as-is | **Deduplicated** (keeps only latest) |
| **Errored tool calls** | Kept forever | Whole failed attempt purged after N turns (input + output, compact error extract); cascades to dependent calls |
| **Manual compaction** | `/compact` (built-in) | left to OpenCode (the plugin does not override it) |
| **Auto-continue** | Always on | Skipped for the compaction agent and duplicate triggers |
| **Prompt application** | Replaces the default | Configurable: `replace` (default) or `augment` (keep the default prompt) |
| **Compress tool** | None | Model-driven **compress** tool (deterministic span selection — no indices needed) |
| **Block folding** | None | Stable `[bN]` block labels for compressed ranges |
| **Graduated eviction** | None | LLM-free `reasoning → bulk output → intermediate → episode`, oldest first (never evicts `user` turns) |
| **Focus** | None | `<latest-user-ask>` block anchored to the current user request |

## Install

### Option 1: One-liner (curl + bash) — macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/BaconDroid/opencode-compaction-plugin/master/install.sh | bash
# or specify a project directory:
curl -fsSL https://raw.githubusercontent.com/BaconDroid/opencode-compaction-plugin/master/install.sh | bash -s /path/to/project
```

### Option 2: One-liner (PowerShell) — Windows

```powershell
irm https://raw.githubusercontent.com/BaconDroid/opencode-compaction-plugin/master/install.ps1 | iex
# or specify a project directory (iex does not forward parameters):
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/BaconDroid/opencode-compaction-plugin/master/install.ps1))) -TargetDir C:\path\to\project
```

### Option 3: npm plugin

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-compaction-plugin"]
}
```

> Requires the package to be published on npm. Until then, use Option 1, 2 or 4.

### Option 4: Manual

```bash
git clone https://github.com/BaconDroid/opencode-compaction-plugin.git
mkdir -p .opencode/plugins/compaction
cp -r opencode-compaction-plugin/src/. .opencode/plugins/compaction/
# OpenCode scans .opencode/plugins/*.ts (not subdirs), so add the barrel entry:
cat > .opencode/plugins/compaction.ts <<'EOF'
export { CompactionPlugin, default } from "./compaction/index.ts"
EOF
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
2. **Deduplication** — When the same tool is called with the same args multiple times, only the latest output is kept. Earlier duplicates are replaced with a short marker.
3. **Error purge** — Purges the whole failed attempt (input + output, with a compact error extract) from errored tool calls older than N turns; `cascade` (on by default) extends the purge to calls that depend on a purged call.
4. **Graduated eviction** — LLM-free eviction (`reasoning → bulk output → intermediate → episode`) once the estimated budget is exceeded; user turns are never evicted.

### 3. `experimental.session.compacting` — Enhanced prompt

When compaction triggers (automatic or manual `/compact`), applies the enhanced 11-section template. By default (`promptMode: "replace"`) it replaces the default prompt; with `"augment"` it keeps OpenCode's default prompt and appends the template. In replace mode the previous compaction summary is fetched and re-injected as `<previous-summary>` so continuity is preserved across repeated compactions (a sliding state avoids re-emitting the same summary). The prompt also carries `<latest-user-ask>` (the current user request) and status markers (`[DONE]`, `[IN PROGRESS]`, `[TODO]`, `[BLOCKED]`, `[FAILED]`, `[UNVERIFIED]`).

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

The plugin exposes one model-driven tool for proactive context management: `compress` (fold). The model decides when to compress and writes the summary itself (it has full context).

### `compress`

| Parameter | Type | Description |
|---|---|---|
| `topic` | string | Short label (3-5 words) for display |
| `summary` | string | Complete technical summary replacing the range |
| `scale` | `"granular"` \| `"deep"` *(optional)* | Descriptive label for the block (does not change span selection) |
| `start` | number *(optional, legacy)* | Explicit start message index (inclusive, 0-based) |
| `end` | number *(optional, legacy)* | Explicit end message index (inclusive, 0-based) |

When `start`/`end` are omitted, the plugin selects the range **deterministically**: everything after the newest existing compressed block, excluding the last `compress.protectedTurns` user turns. The range is replaced with a `<compressed-block>` carrying a durable `id` and a stable `[bN]` label.

## Feature reference

Each feature below lists **what** it does, its **config** keys and how it
**interacts** with the rest. Values live in
[Default Configuration](#default-configuration); ordering guarantees in
[Strategy order & interactions](#strategy-order--interactions).

| Feature | Config | Default |
|---|---|---|
| Structured prompt | `promptMode` | `replace` |
| Previous-summary continuity | — | — |
| Latest user ask | — | — |
| Files-touched manifest | — | — |
| Deduplication | `dedup.{enabled,protectedTools}` | `true`, `[]` |
| Error purge | `purgeErrors.{enabled,turns,wholeAttempt,cascade}` | `true`, `4`, `true`, `true` |
| Graduated eviction | `eviction.{enabled,thresholdTokens,levels,protectPrologue}` | `true`, `200000`, reasoning/bulk_output/intermediate/episode, `true` |
| Auto-continue | — | — |
| Compression tool | `compress.protectedTurns` | `3` |
| Residual/perplexity scoring (optional) | `adapters.scorer.*` | disabled |

### Structured compaction prompt
- **What** — replaces (or augments) OpenCode's default prompt with the 11-section
  template and carries the continuity blocks `<previous-summary>` and
  `<latest-user-ask>`.
- **Config** — `promptMode` (`"replace"` default, or `"augment"`).
- **Interactions** — in `replace` mode the session messages are fetched to populate
  `<previous-summary>`/`<latest-user-ask>`; `augment` keeps OpenCode's prompt and
  does not fetch them.

### Previous-summary continuity
- **What** — re-injects the last compaction summary as `<previous-summary>`; a
  sliding state avoids re-emitting the same summary on repeated compactions.
- **Config** — none (tied to `promptMode: "replace"`).

### Latest user ask
- **What** — anchors the summary with `<latest-user-ask>` (the current user request).
- **Config** — none (replace mode).

### Files-touched manifest
- **What** — records read/write/edit/delete from structured file tools and emits
  an operation-badge manifest (`R`/`W`/`E`/`D`).
- **Config** — none.
- **Interactions** — shell commands (`bash`) are not parsed; files touched only
  through a shell are not listed (the extraction heuristics were fragile).

### Deduplication
- **What** — keeps only the latest of repeated `(tool + args)` calls.
- **Config** — `dedup.{enabled,protectedTools}`.
- **Interactions** — runs before error purge; runs before eviction.

### Error purge
- **What** — purges the whole failed attempt after N turns (`wholeAttempt`: input
  + output + compact error extract); `cascade` (on by default) extends the purge
  to dependent calls.
- **Config** — `purgeErrors.{enabled,turns,wholeAttempt,cascade}`.
- **Interactions** — errored calls within the last `purgeErrors.turns` user turns
  are never purged; `cascade` only fires for calls actually purged.

### Graduated eviction
- **What** — LLM-free eviction (`reasoning → bulk output → intermediate → episode`)
  once the estimated budget is exceeded.
- **Config** — `eviction.{enabled,thresholdTokens,levels,protectPrologue}`.
- **Interactions** — runs last; never evicts user turns or the prologue.

### Auto-continue
- **What** — enables the synthetic continue turn after compaction, except for the
  compaction agent and duplicate triggers (short per-session guard).
- **Config** — none.

### Compression tool
- **What** — `compress` (fold). See [Compression Tools](#compression-tools).
- **Config** — `compress.protectedTurns`.
- **Interactions** — applied in the transform before dedup/purge/eviction.

### Residual/perplexity scoring (optional adapter)
- **What** — eviction normally budgets with the heuristic `estimateTokens`
  (Latin ≈ 4 chars/token; wide CJK characters ≈ 1 token each). When
  `adapters.scorer` is configured, each distinct text part is
  scored once and its residual estimate replaces the heuristic for that text.
  The `opencode` provider reuses a model already configured in OpenCode (no
  endpoint or credentials handled by the plugin) and is **non-blocking**: it
  returns the estimates already cached and warms the rest in the background, so
  a slow model only delays scores to a later transform.
- **Config** — `adapters.scorer.*` (opt-in; off when absent).
- **Interactions** — only affects the eviction budget estimate, and is skipped
  entirely when the heuristic estimate is below 50% of `eviction.thresholdTokens`
  (eviction would not run there). Tool outputs and unscored texts keep the
  heuristic; any scorer error falls back to it.

## Strategy order & interactions

The `messages.transform` pipeline runs in a fixed order (see
[How it works](#2-experimentalchatmessagestransform--context-optimization)):

```
compress → dedup → purge (+cascade) → eviction
```

Override rules:

- **Deduplication** keeps the latest of repeated `(tool + args)` calls; **error
  purge** then removes failed attempts older than `purgeErrors.turns` user turns.
- **Eviction** runs last and never touches user turns or the prologue.

## Configuration

No configuration needed — the plugin works out of the box with sensible defaults. To customize, create a config file at one of:

```
.opencode/compaction.json          # project-local
$XDG_CONFIG_HOME/opencode/compaction.json   # global (~/.config/opencode/...)
```

or the same names with the `.jsonc` extension (comments and trailing commas allowed).

You can also configure the plugin inline through the `opencode.json` plugin entry:

```json
{
  "plugin": [
    ["github:BaconDroid/opencode-compaction-plugin", { "purgeErrors": { "turns": 6 } }]
  ]
}
```

Precedence, low to high: **defaults → global file → plugin options → project file**.

### Default Configuration

```jsonc
{
    // Enable/disable the entire plugin
    "enabled": true,

    // Debug logging: gates info logs; warn logs are always emitted (OpenCode's app log)
    "debug": false,

    // Deduplication: remove duplicate tool calls (same tool + same args)
    "dedup": {
        "enabled": true,
        "protectedTools": []  // Tool names to exclude from dedup
    },

    // Error purge: strip the whole failed attempt (input + output) after N turns
    "purgeErrors": {
        "enabled": true,
        "turns": 4,             // Purge errored calls older than N user turns
        "wholeAttempt": true,   // Also replace the output with a compact error extract
        "cascade": true         // Cascade the purge to calls depending on a purged call
    },

    // Model-driven compression tool
    "compress": {
        "protectedTurns": 3         // Trailing user turns excluded from deterministic selection
    },

    // Graduated, LLM-free eviction
    "eviction": {
        "enabled": true,
        "thresholdTokens": 200000,  // Runs only above this estimated budget
        "levels": ["reasoning", "bulk_output", "intermediate", "episode"],
        "protectPrologue": true     // Never evict the first message
    },

    // How the compaction prompt is applied: "replace" (default) or "augment"
    // ("augment" keeps OpenCode's default prompt and appends these instructions)
    "promptMode": "replace"
}
```

### Optional adapters 🔌

The plugin is fully functional with **no adapter configured** — the scorer has a
deterministic internal version (the heuristic `estimateTokens`). Adapters are
strictly **opt-in** and **fail-open**: they are disabled unless configured, and
any error or timeout is logged and falls back to the internal behaviour, so a
broken adapter can never break compaction. No dependency is added: adapters talk
to an endpoint/command you already run.

One adapter exists today, enabled by adding its block (there is no default value,
so it is off unless present):

- **`adapters.scorer`** — residual/perplexity estimate for the eviction budget (E5/E9).

```jsonc
{
    "adapters": {
        "scorer": {
            "provider": "opencode",          // "opencode" | "http" | "command"
            "model": "opencode/big-pickle",  // free OpenCode Zen model (default); "host" reuses the active model
            "timeoutMs": 30000,
            "maxSamples": 200                // max distinct texts scored per transform
        }
    }
}
```

**Provider `opencode`** — reuses a model already configured in OpenCode through a
sandboxed session, so OpenCode keeps handling provider auth and no key or
endpoint is set here. `model` defaults to the free `opencode/big-pickle`; set it
to `"host"` to reuse the model OpenCode is already using. The scorer is gated so
the model is only used when it helps: it runs only near the eviction budget and
warms its cache in the background, so a slow model never blocks a transform. A
model call is never nested: while one adapter call is in flight, another falls
back to its deterministic behaviour.

**Provider `http`** — POSTs `{ "model"?, "text": "…" }` and accepts a bare
number, a numeric string or `{ "score" | "value" | "tokens" | "residual" }`. This
covers local servers such as Ollama, llama.cpp, LM Studio or vLLM.

**Provider `command`** — spawns `command` and writes `{ "model"?, "text": "…" }`
on stdin. It reads the same response shapes as the HTTP provider on stdout. The
process is non-interactive (stdin is closed) and killed on timeout.

**Provider `mcp`** — recognised but **not supported yet**; it logs a warning and
uses the deterministic fallback. `mcp` requires SDK surface the plugin does not
have.

Security: `url` and `command` are user-supplied and are never logged; put any
token in the URL/command/env yourself. A `command` value is executed by your
shell — treat it like any other local configuration.

### Customizing the prompt

To customize the compaction prompt, modify the `buildCompactionPrompt()` function in `src/core/prompt.ts`. The template is a plain string that you can edit to add or remove sections.

## Development

```bash
# Install dependencies
bun install

# Run tests (Bun's built-in runner — no Vitest)
bun run test

# Watch mode
bun run test:watch

# Run tests with coverage (70% thresholds, see bunfig.toml)
bun run test:coverage

# The plugin is TypeScript — no build step needed for OpenCode
# (OpenCode loads .ts files directly via Bun)
```

Current coverage: **95.1% functions, 98.2% lines** (190 tests).

## File Structure

Split by layer: the entry wiring, the domain `core/` (no OpenCode SDK), the
`config/` loader and the `opencode/` SDK boundary.

```
src/
  index.ts              — Plugin entry point (hooks wiring)
  types.ts              — Shared types (messages, hooks, logger)
  core/                 — Domain logic (no OpenCode SDK)
    transform.ts        — messages.transform pipeline
    requests.ts         — queued compression application
    compress.ts         — compress domain + block rendering
    blocks.ts           — durable block ids + deterministic span selection
    adapters.ts         — optional adapter contract (scorer)
    scorer.ts           — optional scorer-calibrated token estimator
    strategies.ts       — dedup, error purge, cascade purge
    eviction.ts         — graduated, LLM-free eviction
    messages.ts         — message-part helpers
    prompt.ts           — compaction prompt template (11 sections)
    previous-summary.ts — previous summary extraction + sliding state
    files-touched.ts    — file operation tracker + manifest
    store.ts            — per-session keyed queue shared by the compression store
  config/
    config.ts           — config types, defaults and merge
    config-loader.ts    — JSON/JSONC file loading
  opencode/
    tools.ts            — model-driven tool definitions (SDK boundary)
    model.ts            — opencode-model runner (scorer adapter)
    adapters.ts         — optional adapter provider resolution (http/command/opencode)
test/
  index.test.ts     — Plugin integration tests
  compat.test.ts    — omo-slim compatibility contract
  prompt.test.ts    — Prompt template tests
  files-touched.test.ts — File tracker tests
  config.test.ts    — Config loading tests
  strategies.test.ts — Strategy unit tests
  compress.test.ts  — Compress tests
  blocks.test.ts    — Block id and span selection tests
  eviction.test.ts  — Graduated eviction tests
  previous-summary.test.ts — Previous summary and sliding-state tests
  scorer.test.ts    — Optional scorer adapter, estimator and eviction integration
  model.test.ts     — Optional opencode-model runner (host/default model, fail-open)
  messages.test.ts  — Message helper tests
  helpers.ts        — Shared test setup + recording logger
```

## Compatibility

- OpenCode >= 0.1.0 (with plugin support and `experimental.session.compacting` hook)
- The `experimental.*` hooks are marked experimental and may change in future OpenCode versions

### oh-my-opencode-slim

Compatible with [`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim). The two plugins register overlapping hooks but do not conflict:

- `experimental.session.compacting` — omo-slim only marks the session (it does not touch `output.prompt`/`output.context`), so this plugin's prompt handling is unaffected.
- `experimental.chat.messages.transform` — omo-slim rewrites user text and image parts; this plugin dedups/purges tool parts and applies compressions. Load omo-slim **before** this plugin so its in-place rewrites run before this plugin's structural compression.
- `config` — omo-slim manages agents, MCPs and commands; this plugin only ensures permissions for its own tool (`compress`) and leaves a global permission string untouched.
- No shared tool names (omo-slim: `task*`, `waitForUser`, `acpRun`, `webfetch`, `ast_grep_*`, `marketplace_*`; this plugin: `compress`).
- omo-slim does not use `experimental.compaction.autocontinue` and does not mutate `permission`.

Recommended `plugin` order in `opencode.json`:

```json
{
  "plugin": ["oh-my-opencode-slim@latest", "github:BaconDroid/opencode-compaction-plugin"]
}
```

## License

MIT
