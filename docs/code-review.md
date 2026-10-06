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
`src/index.ts:423` only clears on `session.deleted`; sessions ending otherwise
leave trackers behind.
→ Note only (OpenCode event coverage unknown).

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

