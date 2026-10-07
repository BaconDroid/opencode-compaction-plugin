/**
 * Auto-continue hardening: suppress duplicate auto-continue for the same
 * session within a short window.
 *
 * A timestamp (rather than a timer) avoids keeping the process alive and needs
 * no cleanup callbacks.
 */

const AUTOCONTINUE_GUARD_MS = 10_000;

export class AutocontinueGuard {
	private marks = new Map<string, number>();

	/** Whether the session is still within the duplicate-suppression window. */
	has(sessionID: string): boolean {
		const at = this.marks.get(sessionID);
		if (at === undefined) return false;
		if (Date.now() - at >= AUTOCONTINUE_GUARD_MS) {
			this.marks.delete(sessionID);
			return false;
		}
		return true;
	}

	mark(sessionID: string): void {
		this.marks.set(sessionID, Date.now());
	}

	clear(sessionID: string): void {
		this.marks.delete(sessionID);
	}

	clearAll(): void {
		this.marks.clear();
	}
}
