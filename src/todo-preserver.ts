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

const STATUS_MARKERS: Record<string, string> = {
	completed: "[x]",
	done: "[x]",
	in_progress: "[~]",
	"in-progress": "[~]",
	active: "[~]",
	cancelled: "[-]",
	canceled: "[-]",
	pending: "[ ]",
	todo: "[ ]",
};

/**
 * Render a todo snapshot as a deterministic `<task-state>` body: IDs, status
 * markers and priorities are preserved so continuity survives compaction.
 */
export function renderTaskState(todos: TodoSnapshot[]): string {
	if (todos.length === 0) return "(none)";
	return todos
		.map((todo) => {
			const status = (todo.status ?? "").toLowerCase();
			const marker = STATUS_MARKERS[status] ?? "[ ]";
			const meta = [
				todo.id ? `id=${todo.id}` : undefined,
				todo.status ? `status=${todo.status}` : undefined,
				todo.priority ? `priority=${todo.priority}` : undefined,
			]
				.filter((value): value is string => Boolean(value))
				.join(", ");
			return `- ${marker} ${todo.content}${meta ? ` (${meta})` : ""}`;
		})
		.join("\n");
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

	/** Return the snapshot without forgetting it. */
	peek(sessionID: string): TodoSnapshot[] | undefined {
		return this.snapshots.get(sessionID);
	}

	clear(sessionID: string): void {
		this.snapshots.delete(sessionID);
	}

	clearAll(): void {
		this.snapshots.clear();
	}
}
