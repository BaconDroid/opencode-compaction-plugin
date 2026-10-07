/**
 * Todo preservation for opencode-live-compaction.
 *
 * Captures a session's todo list before compaction and stores it so it can be
 * restored afterwards. Restoring is best-effort: the writer is an OpenCode
 * internal module that may be unavailable.
 */

export interface TodoSnapshot {
	id?: string;
	content: string;
	status: string;
	priority?: string;
}

/** Normalize the various shapes the todo API may return. */
export function extractTodos(response: unknown): TodoSnapshot[] {
	const payload = response as { data?: unknown } | undefined;
	if (Array.isArray(payload?.data)) {
		return payload.data as TodoSnapshot[];
	}
	if (Array.isArray(response)) {
		return response as TodoSnapshot[];
	}
	return [];
}

/** Per-plugin-instance store of todo snapshots, keyed by session. */
export class TodoPreserver {
	private snapshots = new Map<string, TodoSnapshot[]>();

	capture(sessionID: string, todos: TodoSnapshot[]): void {
		if (todos.length === 0) {
			this.snapshots.delete(sessionID);
			return;
		}
		this.snapshots.set(sessionID, todos);
	}

	/** Return and forget the snapshot for a session. */
	take(sessionID: string): TodoSnapshot[] | undefined {
		const snapshot = this.snapshots.get(sessionID);
		this.snapshots.delete(sessionID);
		return snapshot;
	}

	clear(sessionID: string): void {
		this.snapshots.delete(sessionID);
	}

	clearAll(): void {
		this.snapshots.clear();
	}
}
