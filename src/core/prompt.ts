/**
 * Compaction prompts for opencode-compaction-plugin.
 *
 * Two builders, selected by `promptMode`:
 * - `buildCompactionPrompt` — the full 11-section template, used by `replace`
 *   (it becomes `output.prompt`). A reference copy lives in
 *   `prompts/compaction-11-section.md`.
 * - `buildAugmentPrompt` — an addendum appended to OpenCode's default prompt
 *   (`augment`). It adds only the sections and rules the default summary lacks
 *   instead of restating a full template.
 */

import { lastMessageWhere, partsText } from "./messages.js";

/**
 * Extract the most recent user message text (the "ask") to anchor the summary,
 * truncated to `maxLen` characters.
 */
export function extractLatestUserAsk(
	messages: unknown,
	maxLen = 800,
): string | undefined {
	const found = lastMessageWhere(
		messages,
		(message) => message.info?.role === "user" && partsText(message.parts) !== "",
	);
	if (!found) return undefined;
	const text = partsText(found.message.parts);
	return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/** Remove a block's own tags from injected text so it cannot break out. */
function stripTags(text: string, tag: string): string {
	return text.split(`<${tag}>`).join("").split(`</${tag}>`).join("");
}

/**
 * Full 11-section template, used as `output.prompt` in `replace` mode.
 */
export function buildCompactionPrompt(input: {
	filesTouched?: string;
	previousSummary?: string;
	focus?: string;
}): string {
	const filesBlock = input.filesTouched
		? `\n\n${input.filesTouched}`
		: "";

	const previousBlock = input.previousSummary
		? `\n\n<previous-summary>\n${stripTags(input.previousSummary, "previous-summary")}\n</previous-summary>`
		: "";

	const focusBlock = input.focus
		? `\n\n<latest-user-ask>\n${stripTags(input.focus, "latest-user-ask")}\n</latest-user-ask>`
		: "";

	return `You are an anchored context summarization assistant for coding sessions.

Summarize ONLY the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.
${previousBlock}
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

/**
 * Augment addendum: appended to OpenCode's default compaction prompt, which is
 * kept intact. It adds only the sections the default summary lacks, plus the
 * rules that make the added sections usable. The default prompt already covers
 * Goal/Constraints/Progress/Decisions/Next Steps/Critical Context/Relevant
 * Files, so those are not restated here.
 */
export function buildAugmentPrompt(input: {
	filesTouched?: string;
	focus?: string;
}): string {
	const filesBlock = input.filesTouched
		? `\n\n${input.filesTouched}`
		: "";

	const focusBlock = input.focus
		? `\n\n<latest-user-ask>\n${stripTags(input.focus, "latest-user-ask")}\n</latest-user-ask>`
		: "";

	return `Keep the default summary structure. In addition, extend the summary with the sections below, appended after the default sections in this order.${focusBlock}

## Brief
- [1-2 sentence executive summary of the session state]

## User Intent Trail
- [chronological list of what the user asked for, with exact quotes when they changed direction]

## Errors & Dead Ends
- [approaches tried that failed, with error strings and why they didn't work, or "(none)"]

## Status
Use one status marker per bullet: [DONE] · [IN PROGRESS] · [TODO] · [BLOCKED] · [FAILED] · [UNVERIFIED].
- [marker + item, or "(none)"]

## Task Continuity
- [what the agent was actively doing when compaction triggered, files open, commands pending, and any active subagent task_ids so delegated work can be resumed instead of restarted, or "(none)"]

## Open Issues & Questions
- [unresolved issues, questions needing user input, or "(none)"]

## Mandatory Reading
- [files or paths that MUST be read first to resume context, or "(none)"]
${filesBlock}

Rules:
- Keep every added section, even when empty — use "(none)" as placeholder.
- Preserve exact file paths, commands, error strings, and identifiers.
- Preserve active subagent/task identifiers (task_id) so delegated work can be resumed instead of restarted.
- Do NOT mention the summary process or that context was compacted.
- Respond in the same language as the conversation.`;
}
