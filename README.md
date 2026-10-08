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
| **Errored tool calls** | Kept forever | Whole failed attempt purged after N turns (input + output, compact error extract); cascades to dependent calls |
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
| **Constraint pinning** | None | Opt-in patterns whose clauses survive trim/dedup/purge/eviction and are re-injected verbatim (`<pinned-constraints>`) |
| **Focus** | None | `<latest-user-ask>` block anchored to the current user request |

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
6. **Error purge** — Purges the whole failed attempt (input + output, with a compact error extract) from errored tool calls older than N turns; `cascade` extends the purge to calls that depend on a purged call.
7. **Graduated eviction** — Opt-in, LLM-free eviction (`reasoning → bulk output → intermediate → episode`) once the estimated budget is exceeded; user turns are never evicted.

Messages matching `pinning.patterns` are **pinned**: they are skipped by trimming, dedup, purge and eviction, and their clauses are re-injected into the compaction prompt as `<pinned-constraints>`.

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

The plugin exposes six model-driven tools for proactive context management: `compress` and `squash` (fold), `expand` and `recall` (restore), `inspect` and `search` (browse/retrieve). The model decides when to compress and writes the summaries itself (it has full context).

### `compress`

| Parameter | Type | Description |
|---|---|---|
| `topic` | string | Short label (3-5 words) for display |
| `summary` | string | Complete technical summary replacing the range |
| `scale` | `"granular"` \| `"deep"` *(optional)* | One message vs. a whole range (default: deep) |
| `start` | number *(optional, legacy)* | Explicit start message index (inclusive, 0-based) |
| `end` | number *(optional, legacy)* | Explicit end message index (inclusive, 0-based) |

When `start`/`end` are omitted, the plugin selects the range **deterministically**: everything after the newest existing compressed block, excluding the last `compress.protectedTurns` user turns. The range is replaced with a `<compressed-block>` carrying a durable `id` and a stable `[bN]` label. The originals are kept in memory when `compress.reversible` is enabled (off by default).

### `squash`

Merges two or more **contiguous** compressed blocks (referenced by `[bN]` labels) into a single block: `{ from, to, topic, summary }`. Ambiguous requests (unknown labels, fewer than two blocks, non-contiguous, or more than `compress.maxBlocksPerSquash`) are refused.

### `expand` / `recall`

Restore a compressed block's original messages from the in-memory sidecar, referenced by `[bN]` label or durable id. `expand` is **sticky** (stays expanded on later turns); `recall` is **one-shot**. Both are applied on the next message transform cycle.

### `inspect` / `search`

`inspect` lists the compressed blocks currently held in memory (labels, topics, sizes). `search` runs a **deterministic** case-insensitive keyword search over the stored originals (no embeddings) and returns matching `[bN]` labels with a snippet; use `expand`/`recall` to restore a match. Both return their result directly and are bounded by `compress.searchMaxResults`.

When the optional [semantic retrieval adapter](#optional-adapters-) is configured, `search` runs embedding-based retrieval first and falls back to the keyword search on any error or when it finds nothing.

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

## Feature reference

Each feature below lists **what** it does, its **config** keys and how it
**interacts** with the rest. Values live in
[Default Configuration](#default-configuration); ordering guarantees in
[Strategy order & interactions](#strategy-order--interactions).

| Feature | Config | Default |
|---|---|---|
| Structured prompt | `promptMode` | `replace` |
| Previous-summary continuity | — | — |
| Task state (todos) | — | — |
| Latest user ask | — | — |
| Files-touched manifest | — | — |
| Tool-output trimming | `trim.*` | see Default Configuration |
| Turn protection | `turnProtection.{enabled,turns}` | `true`, `4` |
| Protected files | `protectedFilePatterns` | `[]` |
| Deduplication | `dedup.{enabled,protectedTools}` | `true`, `[]` |
| Error purge | `purgeErrors.{enabled,turns,wholeAttempt,cascade}` | `true`, `4`, `true`, `true` |
| Graduated eviction | `eviction.{enabled,thresholdTokens,levels,protectPrologue}` | `true`, `80000`, all levels, `true` |
| Constraint pinning | `pinning.{enabled,patterns,maxClauses}` | `true`, `[]`, `20` |
| Preemptive compaction | `preemptiveCompaction.*` | disabled |
| Degradation monitor | `degradationMonitor.{enabled,threshold,windowMs}` | `false`, `4`, `120000` |
| Auto-continue | — | — |
| Compression tools | `compress.{protectedTurns,reversible,maxBlocksPerSquash,searchMaxResults}` | `3`, `false`, `8`, `5` |
| Semantic retrieval (optional) | `adapters.embeddings.*` | disabled |
| Semantic constraint validation (optional) | `adapters.judge.*` | disabled |
| Residual/perplexity scoring (optional) | `adapters.scorer.*` | disabled |

### Structured compaction prompt
- **What** — replaces (or augments) OpenCode's default prompt with the 11-section
  template and carries the continuity blocks `<previous-summary>`,
  `<task-state>`, `<latest-user-ask>` and `<pinned-constraints>`.
- **Config** — `promptMode` (`"replace"` default, or `"augment"`).
- **Interactions** — in `replace` mode the session messages are fetched to populate
  the blocks; `augment` keeps OpenCode's prompt and only fetches when
  `pinning.patterns` is set.

### Previous-summary continuity
- **What** — re-injects the last compaction summary as `<previous-summary>`; a
  sliding state avoids re-emitting the same summary on repeated compactions.
- **Config** — none (tied to `promptMode: "replace"`).

### Task state (todos)
- **What** — captures the todo list before compaction, restores it after
  (best-effort) and renders `<task-state>` with ids/statuses/priorities.
- **Config** — none.

### Latest user ask
- **What** — anchors the summary with `<latest-user-ask>` (the current user request).
- **Config** — none (replace mode).

### Files-touched manifest
- **What** — records read/write/edit/delete and emits an operation-badge manifest
  (`R`/`W`/`E`/`D`).
- **Config** — none.

### Tool-output trimming
- **What** — truncates long tool outputs to per-tool limits, keeping the tail.
- **Config** — `trim.*` (per-tool limits + `default`).
- **Interactions** — skipped for protected files, recent turns and pinned messages;
  idempotent (an already-trimmed output is not re-trimmed).

### Turn protection
- **What** — never trims tool outputs from the last N user turns.
- **Config** — `turnProtection.{enabled,turns}`.
- **Interactions** — overrides trimming; the same window also protects purge.

### Protected file patterns
- **What** — never trims outputs from files matching glob patterns.
- **Config** — `protectedFilePatterns` (globs).
- **Interactions** — trimming only.

### Deduplication
- **What** — keeps only the latest of repeated `(tool + args)` calls.
- **Config** — `dedup.{enabled,protectedTools}`.
- **Interactions** — skipped for pinned messages; runs before error purge.

### Error purge
- **What** — purges the whole failed attempt after N turns (`wholeAttempt`: input
  + output + compact error extract) and `cascade`s to dependent calls.
- **Config** — `purgeErrors.{enabled,turns,wholeAttempt,cascade}`.
- **Interactions** — recent turns and pinned messages are never purged; `cascade`
  only fires for calls actually purged.

### Graduated eviction
- **What** — LLM-free eviction (`reasoning → bulk_output → intermediate → episode`)
  once the estimated budget is exceeded.
- **Config** — `eviction.{enabled,thresholdTokens,levels,protectPrologue}`.
- **Interactions** — runs last; never evicts user turns, the prologue or pinned messages.

### Constraint pinning
- **What** — clauses matching `pinning.patterns` survive compaction and are
  re-injected verbatim as `<pinned-constraints>`; a deterministic integrity check
  warns when a clause is missing from the produced summary.
- **Config** — `pinning.{enabled,patterns,maxClauses}`.
- **Interactions** — overrides trimming, dedup, purge and eviction for matched messages.

### Preemptive compaction
- **What** — calls `session.summarize` before the context is full.
- **Config** — `preemptiveCompaction.{enabled,threshold,absoluteTokenThreshold,countCacheTokens,minTokensSinceLast,minMessagesSinceLast,tailGuard,cooldownMs,contextLimit}`.
- **Interactions** — threshold is `min(contextLimit × threshold, absoluteTokenThreshold)`;
  the gates compose (AND) with the cooldown; the same usage signal gates the
  `compress` tool (below 50% of the threshold defers it).

### Degradation monitor
- **What** — post-compaction diagnostic: warns when assistant messages stop producing text.
- **Config** — `degradationMonitor.{enabled,threshold,windowMs}`.

### Auto-continue
- **What** — enables the synthetic continue turn after compaction, except for the
  compaction agent and duplicate triggers (short per-session guard).
- **Config** — none.

### Compression tools
- **What** — `compress`/`squash` (fold), `expand`/`recall` (restore), `inspect`/`search`
  (browse/retrieve). See [Compression Tools](#compression-tools).
- **Config** — `compress.{protectedTurns,reversible,maxBlocksPerSquash,searchMaxResults}`.
- **Interactions** — applied in the transform before trimming.

### Semantic retrieval (optional adapter)
- **What** — when `adapters.embeddings` is configured, `search` ranks stored
  blocks by embedding similarity (cosine) instead of keyword substring.
- **Config** — `adapters.embeddings.*` (opt-in; off when absent).
- **Interactions** — semantic hits are tried first; any error (timeout, bad
  response) or an empty result falls back to the deterministic keyword search.
  Never changes the transform/compaction path.

### Semantic constraint validation (optional adapter)
- **What** — after compaction, the pinned constraints are already checked by a
  deterministic substring test. When `adapters.judge` is configured and a clause
  looks missing, the judge is asked whether the summary preserves it semantically
  (paraphrase allowed).
- **Config** — `adapters.judge.*` (opt-in; off when absent).
- **Interactions** — only runs for clauses the substring check flagged; a `YES`
  suppresses the warning, a `NO`/unclear answer or any judge error keeps it.

### Residual/perplexity scoring (optional adapter)
- **What** — eviction normally budgets with the heuristic `estimateTokens`
  (chars ÷ 4). When `adapters.scorer` is configured, each distinct text part is
  scored once and its residual estimate replaces the heuristic for that text.
- **Config** — `adapters.scorer.*` (opt-in; off when absent).
- **Interactions** — only affects the eviction budget estimate; tool outputs and
  unscored texts keep the heuristic; any scorer error falls back to it.

## Strategy order & interactions

The `messages.transform` pipeline runs in a fixed order (see
[How it works](#2-experimentalchatmessagestransform--context-optimization)):

```
compress → squash → expand → trim → dedup → purge (+cascade) → eviction
```

Override rules:

- **Pinned messages** (`pinning.patterns`) are skipped by **all** of trim, dedup,
  purge and eviction.
- **Protected files** (`protectedFilePatterns`) affect **trimming** only; **recent
  turns** (`turnProtection`) affect trimming and purge.
- The protect mechanisms are independent and compose — a message is skipped if any applies.

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

    // Error purge: strip the whole failed attempt (input + output) after N turns
    "purgeErrors": {
        "enabled": true,
        "turns": 4,             // Purge errored calls older than N user turns
        "wholeAttempt": true,   // Also replace the output with a compact error extract
        "cascade": true         // Cascade the purge to calls depending on a purged call
    },

    // Model-driven compression tools
    "compress": {
        "protectedTurns": 3,        // Trailing user turns excluded from deterministic selection
        "reversible": false,        // Keep originals in memory for expand/recall
        "maxBlocksPerSquash": 8,    // Max blocks merged by a single squash
        "searchMaxResults": 5       // Max hits returned by the `search` tool
    },

    // Graduated, LLM-free eviction
    "eviction": {
        "enabled": true,
        "thresholdTokens": 80000,   // Eviction runs only above this estimated budget
        "levels": ["reasoning", "bulk_output", "intermediate", "episode"],
        "protectPrologue": true     // Never evict the first message
    },

    // Constraint pinning (E6): matched clauses survive compaction and are re-injected
    "pinning": {
        "enabled": true,
        "patterns": [],             // Case-insensitive substrings, e.g. ["NEVER", "AGENTS.md"]
        "maxClauses": 20            // Max pinned clauses re-injected into the prompt
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
        "countCacheTokens": true,     // count cache read/write tokens (matches OpenCode's context size)
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
        "threshold": 4,          // consecutive assistant messages without text
        "windowMs": 120000       // only checked within this window after compaction
    },

    // Glob patterns for files whose outputs should never be trimmed
    "protectedFilePatterns": []
}
```

### Optional adapters 🔌

The plugin is fully functional with **no adapter configured** — every ensemble
has a deterministic internal version. Adapters are strictly **opt-in** and
**fail-open**: they are disabled unless configured, and any error or timeout is
logged and falls back to the internal behaviour, so a broken adapter can never
break compaction. No dependency is added: adapters talk to an endpoint/command
you already run.

Three adapters exist today, each enabled by adding a block (there is no default
value, so each is off unless present):

- **`adapters.embeddings`** — semantic retrieval for `search` (E4).
- **`adapters.judge`** — semantic constraint validation after compaction (E6).
- **`adapters.scorer`** — residual/perplexity estimate for the eviction budget (E5/E9).

```jsonc
{
    "adapters": {
        "embeddings": {
            "enabled": true,                 // optional (default: true when present)
            "provider": "http",              // "http" (default) | "command" | "mcp"
            "url": "http://localhost:11434/v1/embeddings",
            "model": "nomic-embed-text",     // optional, forwarded to the provider
            "timeoutMs": 10000,              // optional request timeout
            "minScore": 0.25                 // optional minimum cosine score for a hit
        },
        "judge": {
            "provider": "http",
            "url": "http://localhost:11434/v1/chat/completions",
            "model": "llama3.2",
            "timeoutMs": 20000
        },
        "scorer": {
            "provider": "http",
            "url": "http://localhost:8080/score",
            "timeoutMs": 10000,
            "maxSamples": 200                // max distinct texts scored per transform
        }
    }
}
```

**Provider `http`** — for `embeddings`, POSTs an OpenAI-style request
(`{ "model"?, "input": ["text", …] }`) and accepts the response as a bare
`number[][]`, `{ "embeddings": number[][] }` or OpenAI's
`{ "data": [{ "embedding": number[] }] }`. For `judge`, POSTs a chat request
(`{ "model"?, "messages": [{ "role": "user", "content": prompt }] }`) and
accepts `{ "choices": [{ "message": { "content": "…" } }] }`, `{ "response" }`,
`{ "content" }`, `{ "text" }` or `{ "answer" }`. For `scorer`, POSTs
`{ "model"?, "text": "…" }` and accepts a bare number, a numeric string or
`{ "score" | "value" | "tokens" | "residual" }`. This covers local servers such
as Ollama, llama.cpp, LM Studio or vLLM.

**Provider `command`** — spawns `command` and writes `{ "model"?, "input": [...] }`
(`embeddings`), `{ "model"?, "prompt": "…" }` (`judge`) or
`{ "model"?, "text": "…" }` (`scorer`) on stdin. It reads the same response
shapes as the HTTP provider on stdout; for `judge`, plain text stdout is
accepted too. The process is non-interactive (stdin is closed) and killed on
timeout.

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

Current coverage: **96.5% functions, 99.7% lines** (289 tests).

## File Structure

Split by layer: the entry wiring, the domain `core/` (no OpenCode SDK), the
`config/` loader and the `opencode/` SDK boundary.

```
src/
  index.ts              — Plugin entry point (hooks wiring)
  types.ts              — Shared types (messages, hooks, logger)
  core/                 — Domain logic (no OpenCode SDK)
    transform.ts        — messages.transform pipeline
    requests.ts         — queued compress/squash/expand application
    compress.ts         — compress/squash domain + block rendering
    blocks.ts           — durable block ids + deterministic span selection
    expand.ts           — reversible sidecar + inspection/search
    adapters.ts         — optional adapter contracts + in-memory vector index
    judge.ts            — optional judge orchestration for constraint validation
    scorer.ts           — optional scorer-calibrated token estimator
    strategies.ts       — dedup, error purge, cascade purge
    eviction.ts         — graduated, LLM-free eviction
    pin.ts              — constraint pinning (E6)
    trim.ts             — tool-output trimming + protected files
    messages.ts         — message-part helpers
    prompt.ts           — compaction prompt template (11 sections)
    previous-summary.ts — previous summary extraction + sliding state
    todo-preserver.ts   — todo snapshot/restore + <task-state>
    files-touched.ts    — file operation tracker + manifest
    degradation-monitor.ts — post-compaction degradation diagnostic
    preemption.ts       — trigger logic + preemption controller
    glob.ts             — glob matcher for protected files
  config/
    config.ts           — config types, defaults and merge
    config-loader.ts    — JSON/JSONC file loading
  opencode/
    tools.ts            — model-driven tool definitions (SDK boundary)
    adapters.ts         — optional adapter provider resolution (http/command)
test/
  index.test.ts     — Plugin integration tests
  compat.test.ts    — omo-slim compatibility contract
  prompt.test.ts    — Prompt template tests
  files-touched.test.ts — File tracker tests
  config.test.ts    — Config loading tests
  strategies.test.ts — Strategy unit tests
  glob.test.ts      — Glob matcher tests
  compress.test.ts  — Compress/squash tests
  blocks.test.ts    — Block id and span selection tests
  expand.test.ts    — Reversible expand/recall tests
  eviction.test.ts  — Graduated eviction tests
  todo-preserver.test.ts — Todo preserver and task-state tests
  preemption.test.ts — Trigger, gates and preemptive tests
  degradation-monitor.test.ts — Degradation monitor tests
  previous-summary.test.ts — Previous summary and sliding-state tests
  pin.test.ts       — Constraint pinning tests
  adapters.test.ts  — Optional embedding adapter contracts, providers and fallback
  judge.test.ts     — Optional judge adapter, verdict parsing and E6 validation
  scorer.test.ts    — Optional scorer adapter, estimator and eviction integration
  trim.test.ts      — Tool-output trimming tests
  messages.test.ts  — Message helper tests
docs/
  context-compaction-research.md — Consolidated literature catalog, categories and implementation backlog
  research-prompt.md — Reusable prompt (bootstrap + sweep) to reproduce the literature sweep
  ensembles/        — Per-ensemble research, plans and results (E1–E5)
```

## Compatibility

- OpenCode >= 0.1.0 (with plugin support and `experimental.session.compacting` hook)
- The `experimental.*` hooks are marked experimental and may change in future OpenCode versions

### oh-my-opencode-slim

Compatible with [`oh-my-opencode-slim`](https://github.com/alvinunreal/oh-my-opencode-slim). The two plugins register overlapping hooks but do not conflict:

- `experimental.session.compacting` — omo-slim only marks the session (it does not touch `output.prompt`/`output.context`), so this plugin's prompt handling is unaffected.
- `experimental.chat.messages.transform` — omo-slim rewrites user text and image parts; this plugin trims/dedups/purges tool parts and applies compressions. Load omo-slim **before** this plugin so its in-place rewrites run before this plugin's structural compression.
- `config` — omo-slim manages agents, MCPs and commands; this plugin only ensures permissions for its own tools (`compress`, `squash`, `expand`, `recall`, `inspect`, `search`) and leaves a global permission string untouched.
- No shared tool names (omo-slim: `task*`, `waitForUser`, `acpRun`, `webfetch`, `ast_grep_*`, `marketplace_*`; this plugin: `compress`, `squash`, `expand`, `recall`, `inspect`, `search`).
- omo-slim does not use `experimental.compaction.autocontinue` and does not mutate `permission`.

Recommended `plugin` order in `opencode.json`:

```json
{
  "plugin": ["oh-my-opencode-slim@latest", "github:BaconDroid/opencode-live-compaction"]
}
```

## License

MIT
