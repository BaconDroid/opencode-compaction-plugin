/**
 * Post-compaction degradation diagnostic for opencode-live-compaction.
 *
 * After a compaction, a model can stop producing text (only tool calls) and
 * appear stuck. This tracks a short window after compaction and counts trailing
 * assistant messages without text, so the plugin can surface a warning.
 *
 * Diagnostic only: it never modifies messages.
 */

/** True when a message's parts include a non-empty text part. */
export function messageHasText(parts: unknown): boolean {
	if (!Array.isArray(parts)) return false;
	return parts.some((part) => {
		const p = part as { type?: string; text?: string } | null;
		return (
			p?.type === "text" &&
			typeof p.text === "string" &&
			p.text.trim().length > 0
		);
	});
}

/** Count trailing assistant messages that carry no text. */
export function countTrailingNoTextAssistant(
	messages: Array<{ info?: { role?: string }; parts?: unknown }>,
): number {
	let count = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.info?.role !== "assistant") break;
		if (messageHasText(msg.parts)) break;
		count++;
	}
	return count;
}

// ---------------------------------------------------------------------------
// Judge-free halting rule (semantic-halting-problem style)
// ---------------------------------------------------------------------------

export interface HaltingConfig {
	/** Distance below which consecutive drafts are considered converged. */
	convergenceThreshold: number;
	/** Number of consecutive converged steps required to halt. */
	convergencePatience: number;
	/** Failsafe: halt after this many rounds regardless of distance. */
	maxRounds: number;
}

export interface HaltDecision {
	shouldHalt: boolean;
	reason?: "entropy" | "max_rounds";
}

/** Normalized Jaccard distance between two texts (0 identical, 1 disjoint). */
export function textDistance(a: string, b: string): number {
	const normalize = (value: string) =>
		value.toLowerCase().replace(/\s+/g, " ").trim();
	const na = normalize(a);
	const nb = normalize(b);
	if (!na && !nb) return 0;
	if (!na || !nb) return 1;
	const setA = new Set(na.split(" "));
	const setB = new Set(nb.split(" "));
	let intersection = 0;
	for (const token of setA) {
		if (setB.has(token)) intersection++;
	}
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : 1 - intersection / union;
}

/**
 * Decide whether to stop a loop from the distance history between consecutive
 * drafts: halt once the last `convergencePatience` distances are all below
 * `convergenceThreshold`, or at `maxRounds` as a failsafe.
 */
export function shpShouldHalt(
	loopCount: number,
	distanceHistory: number[],
	config: HaltingConfig,
): HaltDecision {
	if (loopCount >= config.maxRounds) {
		return { shouldHalt: true, reason: "max_rounds" };
	}
	if (
		config.convergencePatience > 0 &&
		distanceHistory.length >= config.convergencePatience
	) {
		const recent = distanceHistory.slice(-config.convergencePatience);
		if (recent.every((d) => d < config.convergenceThreshold)) {
			return { shouldHalt: true, reason: "entropy" };
		}
	}
	return { shouldHalt: false };
}

/** Per-plugin-instance record of the last compaction time per session. */
export class DegradationMonitor {
	private compactedAt = new Map<string, number>();
	private drafts = new Map<string, string>();
	private distances = new Map<string, number[]>();

	markCompacted(sessionID: string, now: number): void {
		this.compactedAt.set(sessionID, now);
	}

	/**
	 * Record a draft for a session and return the halting decision based on the
	 * distance from the previous draft.
	 */
	pushDraft(
		sessionID: string,
		draft: string,
		config: HaltingConfig,
	): HaltDecision {
		const previous = this.drafts.get(sessionID);
		const history = this.distances.get(sessionID) ?? [];
		if (previous !== undefined) {
			history.push(textDistance(previous, draft));
		}
		this.drafts.set(sessionID, draft);
		this.distances.set(sessionID, history);
		return shpShouldHalt(history.length, history, config);
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
		this.drafts.delete(sessionID);
		this.distances.delete(sessionID);
	}

	clearAll(): void {
		this.compactedAt.clear();
		this.drafts.clear();
		this.distances.clear();
	}
}
