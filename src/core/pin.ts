/**
 * Constraint pinning (E6, internal): messages whose text matches a configured
 * pattern are "pinned" so they survive trimming, dedup, purge and eviction, and
 * their clauses are re-injected into the compaction prompt verbatim.
 *
 * Deterministic (case-insensitive substring), no model judge.
 */

import { partsText } from "./messages.js";
import type { Message } from "../types.js";

function needlesFor(patterns: string[]): string[] {
	return patterns.map((pattern) => pattern.trim().toLowerCase()).filter(Boolean);
}

/** True when a message's text matches any pinning pattern. */
export function isPinnedMessage(message: Message, patterns: string[]): boolean {
	const needles = needlesFor(patterns);
	if (needles.length === 0) return false;
	const text = partsText(message.parts);
	if (!text) return false;
	const lower = text.toLowerCase();
	return needles.some((needle) => lower.includes(needle));
}

/**
 * Collect the pinned clauses: the matching lines, trimmed, deduplicated and
 * bounded to `maxClauses`.
 */
export function collectPinnedClauses(
	messages: Message[],
	patterns: string[],
	maxClauses = 20,
): string[] {
	const needles = needlesFor(patterns);
	if (needles.length === 0) return [];
	const clauses: string[] = [];
	const seen = new Set<string>();
	for (const message of messages) {
		const text = partsText(message.parts);
		if (!text) continue;
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || seen.has(trimmed)) continue;
			const lower = trimmed.toLowerCase();
			if (!needles.some((needle) => lower.includes(needle))) continue;
			seen.add(trimmed);
			clauses.push(trimmed);
			if (clauses.length >= maxClauses) return clauses;
		}
	}
	return clauses;
}

/** Render the pinned clauses as a bullet list, or `undefined` when empty. */
export function renderPinned(clauses: string[]): string | undefined {
	if (clauses.length === 0) return undefined;
	return clauses.map((clause) => `- ${clause}`).join("\n");
}

/** Return the clauses missing from a produced summary (integrity check). */
export function missingClauses(
	summary: string,
	clauses: string[],
): string[] {
	if (clauses.length === 0) return [];
	const lower = summary.toLowerCase();
	return clauses.filter((clause) => !lower.includes(clause.toLowerCase()));
}
