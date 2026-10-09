/**
 * Markers written into tool outputs by the context strategies. They are shared
 * so every stage can recognize already-processed content and stay idempotent
 * regardless of pipeline order.
 */

/** Prefix of a deduped tool output (`strategies.applyDedup`). */
export const DEDUPED_PREFIX = "[deduped: ";

/** Suffix appended by bulk-output eviction (`eviction.evictBulkOutput`). */
export const EVICTED_BULK_SUFFIX = "\n... [evicted bulk output]";

/** Text replacing an evicted reasoning part (`eviction.evictReasoning`). */
export const REASONING_MARKER = "[evicted reasoning]";

/** Text replacing an evicted intermediate part (`eviction.evictIntermediate`). */
export const INTERMEDIATE_MARKER = "[evicted intermediate]";

/** Text a whole evicted episode collapses to (`eviction.evictEpisode`). */
export const EPISODE_MARKER = "[evicted episode]";
