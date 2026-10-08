/**
 * A per-session queue of items, keyed by session id.
 *
 * The compression / expand stores share this queue/clear surface and
 * only differ in how `drain` orders or retains items.
 */
export class KeyedQueue<T> {
	private queues = new Map<string, T[]>();

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

	/** Store the remaining items for a session (deleting when empty). */
	protected retain(sessionID: string, items: T[]): void {
		if (items.length > 0) this.queues.set(sessionID, items);
		else this.queues.delete(sessionID);
	}

	drain(sessionID: string): T[] {
		return this.take(sessionID);
	}

	clear(sessionID: string): void {
		this.queues.delete(sessionID);
	}

	clearAll(): void {
		this.queues.clear();
	}
}
