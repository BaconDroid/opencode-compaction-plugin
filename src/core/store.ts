/**
 * A per-session queue of items, keyed by session id.
 *
 * The compression store extends this with a session-ordered `drain`.
 */
export class KeyedQueue<T> {
	private queues = new Map<string, T[]>();

	/** Append an item to a session's queue. */
	queue(sessionID: string, item: T): void {
		let queue = this.queues.get(sessionID);
		if (!queue) {
			queue = [];
			this.queues.set(sessionID, queue);
		}
		queue.push(item);
	}

	/** Session ids with a non-empty queue. */
	sessions(): Iterable<string> {
		return this.queues.keys();
	}

	/** Remove and return the queue for a session. */
	protected take(sessionID: string): T[] {
		const queue = this.queues.get(sessionID) ?? [];
		this.queues.delete(sessionID);
		return queue;
	}

	/** Drop a session's queue. */
	clear(sessionID: string): void {
		this.queues.delete(sessionID);
	}

	/** Drop every session's queue. */
	clearAll(): void {
		this.queues.clear();
	}
}
