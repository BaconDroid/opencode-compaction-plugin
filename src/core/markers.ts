/**
 * Markers written into tool outputs by the context strategies. They are shared
 * so every stage can recognize already-processed content and stay idempotent
 * regardless of pipeline order.
 */

/** Prefix of a deduped tool output (`strategies.applyDedup`). */
export const DEDUPED_PREFIX = "[deduped: ";

/** Suffix appended by bulk-output eviction (`eviction.evictBulkOutput`). */
export const EVICTED_BULK_SUFFIX = "\n... [evicted bulk output]";
