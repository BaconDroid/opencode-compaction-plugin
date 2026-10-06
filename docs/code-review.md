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
→ Fix: choose the replacement role from the surrounding context (or reuse the
first replaced message's role).

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
`src/prompt.ts:86-88` exports a system prompt that is never wired into the
compaction hook (only `output.prompt` is set).
→ Fix: document as reserved, or wire it if the API supports a system message.

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
`src/index.ts:198-208`. The OpenCode `app.log` API may expect a structured
object. **Not changed** — API shape unverified and the test asserts a string.

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
