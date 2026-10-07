/**
 * Enhanced compaction prompt template for opencode-live-compaction.
 *
 * Produces a structured summary with 11 continuity sections, inspired by
 * pi-live-compaction but adapted for OpenCode's plugin hook system.
 *
 * The prompt is designed to be set as `output.prompt` in the
 * `experimental.session.compacting` hook.
 */

import { partsText } from "./messages.js";

/**
 * Extract the most recent user message text (the "ask") to anchor the summary,
 * truncated to `maxLen` characters.
 */
export function extractLatestUserAsk(
	messages: unknown,
	maxLen = 800,
): string | undefined {
	if (!Array.isArray(messages)) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as
			| { info?: { role?: string }; parts?: unknown }
			| undefined;
		if (msg?.info?.role !== "user") continue;
		const text = partsText(msg.parts);
		if (!text) continue;
		return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
	}
	return undefined;
}

export function buildCompactionPrompt(input: {
	filesTouched?: string;
	previousSummary?: string;
	taskState?: string;
	focus?: string;
}): string {
	const filesBlock = input.filesTouched
		? `\n\n${input.filesTouched}`
		: "";

	const previousBlock = input.previousSummary
		? `\n\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
		: "";

	const taskStateBlock = input.taskState
		? `\n\n<task-state>\n${input.taskState}\n</task-state>`
		: "";

	const focusBlock = input.focus
		? `\n\n<latest-user-ask>\n${input.focus}\n</latest-user-ask>`
		: "";

	return `You are an anchored context summarization assistant for coding sessions.

Summarize ONLY the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.
${previousBlock}
If the prompt includes a <task-state> block, treat it as the authoritative task list at the moment of compaction: preserve task IDs, statuses and priorities exactly.
${taskStateBlock}
If the prompt includes a <latest-user-ask> block, treat it as the current focus the user is waiting on; keep the summary oriented toward it.
${focusBlock}

Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.

<template>
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
${filesBlock}
</template>

Rules:
- Keep every section, even when empty — use "(none)" as placeholder.
- Prefix each Status bullet with its marker: [DONE], [IN PROGRESS], [TODO], [BLOCKED], [FAILED], or [UNVERIFIED].
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers.
- Quote constraints verbatim and cite their source; never invent or weaken a constraint.
- Preserve active subagent/task identifiers (task_id) so delegated work can be resumed instead of restarted.
- Do NOT mention the summary process or that context was compacted.
- Respond in the same language as the conversation.
- The "User Intent Trail" must capture chronological changes in direction with quote fidelity.
- The "Task Continuity" section must describe the exact moment where work stopped so the next agent can resume seamlessly.
- The "Mandatory Reading" section must list files that hold critical state (e.g., partially edited files, config files being modified, test files being fixed).`;
}
