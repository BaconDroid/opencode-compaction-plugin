# oh-my-openagent (omo) — compaction review

Analysis of how [`code-yeongyu/oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent)
(its OpenCode plugin package `omo-opencode`) handles compaction, and what this
plugin adopted or deferred.

> License: the omo repository is `SUL-1.0` (non-permissive). Only ideas and
> patterns were reused here, never code.

## What omo does

- **`experimental.session.compacting`**: captures a context snapshot and the
  session's todo list, then **`output.context.push(...)`** (augments OpenCode's
  default prompt instead of replacing it) with an 8-section summary prompt.
- **`experimental.compaction.autocontinue`**: disables auto-continue for the
  compaction agent, suppresses duplicate auto-continue with a per-session timer
  (~10s), and restores context/todos after compaction.
- **Todo preserver**: snapshots todos before compaction, restores them after via
  `client.session.todo` + the internal `Todo.update`, guarding against a late
  `todowrite` overwriting the restored snapshot.
- **Preemptive compaction**: proactively calls `session.summarize` when tokens
  reach ~78% of the model's context limit (60s cooldown, 60s timeout), plus a
  post-compaction degradation monitor.
- **Prompt content**: constraints quoted verbatim (cite the source, do not paste
  whole policy files), per-agent verification state, and delegated subagent
  `task_id`s ("RESUME, DON'T RESTART").

## Adopted here

| Idea | Where |
|---|---|
| Skip autocontinue for the compaction agent | `experimental.compaction.autocontinue` |
| Duplicate autocontinue guard (per-session timer) | `experimental.compaction.autocontinue` |
| Error isolation per hook (a throw no longer breaks the pipeline) | `safe()` wrapper around every hook |
| Constraints quoted verbatim; cite the source | compaction prompt |
| Preserve subagent `task_id`s ("resume, don't restart") | compaction prompt |
| Todo list captured before and restored after compaction | `src/todo-preserver.ts` |

## Deferred

### D1 — Preemptive (proactive) compaction
Trigger compaction before the context overflows, based on token usage
(threshold ~78%, cooldown), via `client.session.summarize`. Highest value, but it
uses an internal API and needs careful token accounting and cooldown handling.
Aligns with the research backlog in `context-compaction-research.md`.

### D2 — `output.context` (augment) vs `output.prompt` (replace)
omo augments OpenCode's default compaction prompt; this plugin replaces it to
enforce its 11-section format. A configurable mode (`promptMode: replace |
augment`) would let users keep OpenCode's default prompt and add sections.

### D3 — Post-compaction degradation monitor
omo watches for consecutive assistant messages with no text after compaction and
re-injects agent config. Specific to its multi-agent setup; not adopted.
