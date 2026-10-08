/**
 * Optional model-judge orchestration for semantic validation (E6).
 *
 * After compaction the plugin already checks pinned constraints with a
 * deterministic substring test. When a `Judge` is configured, this module asks
 * it whether a summary that fails that test still preserves the constraints
 * semantically (paraphrase allowed). Pure orchestration over the `Judge`
 * contract; callers catch errors and keep the deterministic result (fail-open).
 */

import type { Judge } from "./adapters.js";

/** Build the constraint-integrity prompt sent to the judge. */
export function buildIntegrityPrompt(
	summary: string,
	clauses: string[],
): string {
	return [
		"You are validating a compaction summary against constraints that MUST be preserved.",
		"Paraphrasing is acceptable: judge meaning, not exact wording.",
		"Answer with a single word: YES if the summary preserves ALL constraints, otherwise NO.",
		"",
		"Constraints:",
		...clauses.map((clause) => `- ${clause}`),
		"",
		"Summary:",
		summary,
	].join("\n");
}

/** Parse a YES/NO verdict; returns `undefined` when the answer is unclear. */
export function parseVerdict(answer: string): boolean | undefined {
	const text = answer.trim().toLowerCase();
	if (!text) return undefined;
	// A bare two-word hedge is not a usable verdict; otherwise the first
	// yes/no wins (so "yes, there is no issue" still reads as yes).
	if (/^(?:yes\s+and\s+no|no\s+and\s+yes)$/.test(text)) return undefined;
	if (/\byes\b/.test(text)) return true;
	if (/\bno\b/.test(text)) return false;
	return undefined;
}

/**
 * Ask the judge whether the summary preserves all clauses. Returns `true`/`false`
 * when a verdict could be parsed, or `undefined` when the judge was unclear.
 */
export async function judgeClausesPreserved(
	judge: Judge,
	summary: string,
	clauses: string[],
): Promise<boolean | undefined> {
	if (clauses.length === 0) return true;
	const answer = await judge.ask(buildIntegrityPrompt(summary, clauses));
	return parseVerdict(answer);
}
