# Code review — opencode-live-compaction

> Findings from a direct read of the plugin source, independent of the
> literature research in `context-compaction-research.md`.
> Baseline: `bun test` → 166 pass / 0 fail; `tsc --noEmit` → 2 errors.

Each finding maps to a branch/PR. Severity: **bug** > **silent failure** >
**robustness** > **cleanup** > **types**.

---

## Bugs

### B1 — Compressions applied cross-session
`src/index.ts:311-331`
The `experimental.chat.messages.transform` hook ignores its `input` (and thus any
`sessionID`) and drains **every** session's pending compressions, then applies
them **by index** to the current message array. A compression queued for session
A can rewrite session B's messages at the same indices. The code comment
(l.315-316) acknowledges the missing `sessionID` but does not fix it.
→ Fix: scope by the `callID` of the compress tool call, which is present in both
`tool.execute.after` and the conversation parts.

### B2 — `/compact:focus` leaks to every session
`src/index.ts:401-403`
The command handler loops over all `sessionTrackers` and sets the focus directive
on **each** session, not only the current one.
→ Fix: keep a single pending directive consumed by the next compaction.

### B3 — `applyCompressions` injects a `user` message
`src/compress.ts:114-127`
Replacing an arbitrary index range with a single `role:"user"` message can break
message-sequence expectations (consecutive user turns / role alternation) on some
providers. Lower severity than B1/B2 because whole messages are replaced (tool
parts are not split), but worth guarding.
→ Resolved (#11): the block now picks a role that avoids a collision with the
preceding message (assistant after a user turn, otherwise user).

---

## Silent failures

### S1 — Protected-file detection ignores `state.input`
`src/index.ts:178-192` reads only `part.args`, while `applyDedup`
(`src/strategies.ts:96`) reads `part.args ?? part.state.input`. If tool args live
under `state.input` in the transform payload, protected patterns never apply —
silently.
→ Fix: mirror the dedup lookup (and JSON-parse a string input).

### S2 — JSONC parser rejects trailing commas
`src/config.ts:200` strips comments but not trailing commas, so a documented
`.jsonc` config with trailing commas fails `JSON.parse`. The `catch`
(`src/config.ts:156`) then falls back to defaults **without any log**, silently
discarding the user's configuration.
→ Fix: strip trailing commas; surface parse errors via the plugin logger.

### S3 — `COMPACTION_SYSTEM_PROMPT` never used
`src/prompt.ts` exports a system prompt that is never wired into the
compaction hook (only `output.prompt` is set).
→ Resolved: same as N4 — the constant was removed (the hook has no system
field).

---

## Robustness

### R1 — Non-idempotent trimming
`src/index.ts:135-147`
The trim runs on every `messages.transform`. Since it returns
`output.slice(-limit) + indicator`, an already-trimmed output is re-sliced and
re-wrapped on each pass, slowly eroding the retained tail.
→ Fix: detect an already-trimmed output (stable trailing marker) and skip.

### R2 — `purgeErrors.turns` unused
`src/config.ts:46,178`, `src/index.ts:377`. The config advertises turn-based
purging but the purge is immediate.
→ Fix: gate the purge on the protected-turn window.

### R3 — Session state cleanup is partial
`src/index.ts` cleared on `session.deleted`, but the handler read
`properties.sessionID` while the SDK event carries `properties.info.id`, so the
cleanup never ran.
→ Resolved: the handler now reads `info.id` (with a `sessionID` fallback) and
clears the tracker, focus directive and compression queue.

---

## Cleanup

### C1 — `files-touched.ts` manifest legend omits `M`
`src/files-touched.ts:103` lists `R/W/E/D` while `OP_LABELS` defines `M` (move);
bash `rm`/`mv` are recorded as `R`. `patch`/`multiedit` are not handled.
→ Fix: align legend, handle `patch`, best-effort classify.

### C2 — `config` hook overwrites user config
`src/index.ts:446-471` unconditionally sets `permission.compress="allow"` and
replaces any existing `compact` command definition.
→ Fix: preserve an existing `compact` command.

### C3 — `makeLogger` passes a string to `client.app.log`
`src/index.ts`. The OpenCode `app.log` API expects
`{ body: { service, level, message, extra? } }` (verified in `@opencode-ai/sdk`).
→ Resolved: the logger and config warnings now call the structured API; the
logger test asserts on `body.service`/`body.message`.

---

## Types / tooling

### T1 — `Hooks` omits `config` and `tool`
`src/index.ts:73-98`; the returned object is cast `as Hooks`, so those two hooks
are not type-checked.
→ Fix: declare them on the interface.

### T2 — tsconfig missing node types + no typecheck script
`tsconfig.json` lacks `"types": ["node"]`; `tsc --noEmit` reports 2 errors in
`config.ts`. `package.json` has no `typecheck`/`lint` script.
→ Fix: add `"types": ["node"]` and a `typecheck` script.

---

## Re-validation (after the fix branches)

Additional findings surfaced while re-reading the merged result.

### N1 — Module-level mutable state is shared across plugin instances
`src/index.ts:107,119,123` and `src/compress.ts:39`
`sessionTrackers`, `focusDirectives`, `pendingFocus`, and `pendingCompressions`
live at module scope. If `LiveCompactionPlugin` is instantiated more than once in
the same process, state is shared (tests already rely on this implicitly).
→ Resolved (#10): state now lives inside `LiveCompactionPlugin`, and the
compression queue is a per-instance `CompressionStore`.

### N2 — Deferred compression requests can accumulate
`src/index.ts:354-378`
A request whose `callID` never appears in a conversation is re-queued on every
transform and never expires. Requests carry a `timestamp`, so a max-age drop is
possible.
→ Resolved (#10): deferred requests older than 30 minutes are dropped.

### N3 — Transform hook `input` is ignored
`src/index.ts:347`
`experimental.chat.messages.transform` receives `input` (currently unused). If
OpenCode supplies a `sessionID` there, scoping could be direct instead of via
`callID` matching.
→ Resolved (#10): the hook now uses `input.sessionID` when present, falling
back to `callID` matching.

### N4 — `COMPACTION_SYSTEM_PROMPT` unused by the plugin
`src/prompt.ts`
Exported and unit-tested, but never wired: the `experimental.session.compacting`
hook output only exposes `context` and `prompt`, with no system-message field.
→ Resolved: the unused constant and its test were removed.

### B3 — role of the compressed block
Resolved (#11): see above.

---

## Re-validation 2

Findings from a fresh pass over the merged code.

### E1 — The `enabled` kill switch was ignored
`src/config.ts` defines `enabled` (default true) and the README documents it as
"enable/disable the entire plugin", but `index.ts` never read it.
→ Resolved: `enabled: false` now returns an empty hooks object (all hooks off).

### E2 — `config` hook corrupted a string permission
`src/index.ts` spread `opencodeConfig.permission` into an object. When
permission is the global shorthand string (e.g. `"permission": "allow"`, as in
the deployed config), `{ ..."allow" }` produced a character map, corrupting the
permission config.
→ Resolved: a string permission is left untouched; an object permission gets
`compress: "allow"` unless it explicitly denies compress.

### E3 — `OP_LABELS` was dead code
`src/files-touched.ts` defined `OP_LABELS` but `renderManifest` hard-coded the
legend.
→ Resolved: the legend is now derived from `OP_LABELS`.

### E4 — `getRecentTurnIndices` with `turns <= 0`
A non-positive protected-turn count still protected trailing messages.
→ Resolved: returns an empty set for `turns <= 0`.

### E5 — `escapeAttr` did not escape `&`
The compressed-block topic escaped quotes and angle brackets but not `&`.
→ Resolved: `&` is escaped first.

---

## Re-validation 3 (SDK cross-check)

Checked the plugin against the real `@opencode-ai/plugin` types and the OpenCode
docs. The inlined types had hidden several API mismatches.

### F1 — The `compress` tool was not a valid `ToolDefinition`
`src/compress.ts`. `ToolDefinition` requires a Zod `args` shape and an
`execute` function; the plugin passed plain `{ type, description }` objects and
no `execute`, so OpenCode could not run the tool.
→ Resolved: built with the SDK `tool()` helper (`tool.schema` args + `execute`).

### F2 — `command.execute.before` used the wrong API and overrode the built-in
`src/index.ts`. The hook signature is `{ command, sessionID, arguments }` →
`{ parts }`, but the plugin read `input.args` and wrote `output.handled` /
`output.message` (none exist). It also registered `command.compact` with an
empty template, which overrides the built-in `/compact` (alias `/summarize`).
→ Resolved: the handler reads `arguments`/`sessionID` and no longer overrides
the built-in command. Focus is set from `/compact focus <directive>`
(best-effort).

### F3 — Dead sessionID branch in the transform hook
`src/index.ts`. `experimental.chat.messages.transform` receives `input: {}`, so
`input.sessionID` was always undefined.
→ Resolved: the branch was removed; `callID` scoping remains.

### F4 — Inlined types diverged from the SDK
`src/index.ts`. The inlined `Hooks`/`PluginInput` masked F1/F2.
→ Partially addressed: the `command.execute.before` and transform signatures now
match the SDK, and the tool uses the SDK helper. Full type import deferred.

---

## Re-validation 4 (SDK `Part` cross-check)

### F5 — Error input purge never ran
`src/strategies.ts`. Real tool parts carry `state.input` as an **object**
(`{ [key: string]: unknown }`, per the SDK `ToolState`), but `applyPurgeErrors`
required `typeof input === "string"`, so it never matched and the purge was dead.
→ Resolved: `applyPurgeErrors` now measures string or object inputs and replaces
a large input with a small `{ purged: "..." }` marker (object inputs stay
objects). Types updated from `string` to `unknown`.

### F6 — Dead `"failed"` status and dedup on error states
`src/strategies.ts`. `ToolState` status is `pending | running | completed |
error`, so the `"failed"` check in `findErroredParts` was dead. `applyDedup`
also marked parts that carry `error` (no `output`), adding an `output` field to
an error state.
→ Resolved: `findErroredParts` matches only `error`; `applyDedup` only considers
parts with a string `output`. Tests updated accordingly.





---

## Re-validation 5

### F7 — The `tool` hook was not a map
`src/index.ts`. The SDK type is `tool?: { [key: string]: ToolDefinition }`, but
the plugin passed a single `ToolDefinition` (`tool: buildCompressToolDef()`), so
OpenCode would iterate `description`/`args`/`execute` as if they were tool names.
The compress tool was registered incorrectly.
→ Resolved: `tool: { compress: buildCompressToolDef() }`; the test now reads
`tool.compress`.

### F8 — Provider catalog read from the wrong path
`src/index.ts` (`resolveContextLimit`). SDK client methods resolve to
`{ data, ... }` (e.g. omo reads `result.data.connected`), but the limit resolver
read `response.all` directly, so the model context limit was never resolved in
production and preemptive compaction never triggered without a `contextLimit`
override. The integration test masked it with an unrealistic mock.
→ Resolved: read `response.data.all` (with an `all` fallback); tests use the
`{ data: ... }` response shape.
