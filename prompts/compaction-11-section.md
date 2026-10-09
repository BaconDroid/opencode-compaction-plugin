# Compaction prompt — 11-section template (reference copy)

Reference copy of the `replace`-mode prompt template. The source of truth is
`buildCompactionPrompt()` in [`src/core/prompt.ts`](../src/core/prompt.ts); this
file mirrors its `<template>` block for reading and editing.

When `promptMode` is `"replace"` this template becomes `output.prompt` and
replaces OpenCode's default compaction prompt. When `promptMode` is `"augment"`
the plugin keeps the default prompt and appends only the delta
(`buildAugmentPrompt`): the sections the default summary lacks.

Placeholders: `${previousBlock}`, `${focusBlock}` and `${filesBlock}` are filled
with the `<previous-summary>`, `<latest-user-ask>` and files-touched manifest
blocks when present.

```markdown
## Brief
- [1-2 sentence executive summary of the session state]

## User Intent Trail
- [chronological list of what the user asked for, with exact quotes when they changed direction, or "(none)"]

## Constraints & Preferences
- [active constraints, quoted verbatim from the user or AGENTS.md; cite the source and quote only the decisive clause — do not paste whole policy files, or "(none)"]

## Errors & Dead Ends
- [approaches tried that failed, with error strings and why they didn't work, or "(none)"]

## Key Decisions
- [decision and why it was made, or "(none)"]

## Status
Use one status marker per bullet: [DONE] completed · [IN PROGRESS] active now · [TODO] not started · [BLOCKED] waiting on something · [FAILED] attempted and failed · [UNVERIFIED] done but not verified.

### Done
- [DONE] [completed work or "(none)"]

### In Progress
- [IN PROGRESS] [current work or "(none)"]

### Blocked
- [BLOCKED] [blockers or "(none)"]

## Task Continuity
- [what the agent was actively doing when compaction triggered, files open, commands pending, and any active subagent task_ids so delegated work can be resumed instead of restarted, or "(none)"]

## Open Issues & Questions
- [unresolved issues, questions needing user input, or "(none)"]

## Next Steps
- [ordered next actions to resume work, or "(none)"]

## Mandatory Reading
- [files or paths that MUST be read first to resume context, or "(none)"]
```

The **Files Touched Manifest** is appended after `Mandatory Reading` when any
structured file operation was recorded.
