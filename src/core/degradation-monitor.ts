/**
 * Post-compaction degradation diagnostic for opencode-live-compaction.
 *
 * After a compaction, a model can stop producing text (only tool calls) and
 * appear stuck. This tracks a short window after compaction and counts trailing
 * assistant messages without text, so the plugin can surface a warning.
 *
 * Diagnostic only: it never modifies messages.
 */

import { hasText } from "./messages.js";

/** Count trailing assistant messages that carry no text. */
export function countTrailingNoTextAssistant(
	messages: Array<{ info?: { role?: string }; parts?: unknown }>,
): number {
	let count = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.info?.role !== "assistant") break;
		if (hasText(msg.parts)) break;
		count++;
	}
	return count;
}

/** Per-plugin-instance record of the last compaction time per session. */
export class DegradationMonitor {
	private compactedAt = new Map<string, number>();

	markCompacted(sessionID: string, now: number): void {
		this.compactedAt.set(sessionID, now);
	}

	/** Whether a check should run: within the post-compaction window. */
	shouldCheck(sessionID: string, now: number, windowMs: number): boolean {
		const at = this.compactedAt.get(sessionID);
		if (at === undefined) return false;
		if (now - at > windowMs) {
			this.compactedAt.delete(sessionID);
			return false;
		}
		return true;
	}

	clear(sessionID: string): void {
		this.compactedAt.delete(sessionID);
	}

	clearAll(): void {
		this.compactedAt.clear();
	}
}
