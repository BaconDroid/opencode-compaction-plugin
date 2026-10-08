/**
 * Markers written into tool outputs by the context strategies. They are shared
 * so every stage can recognize already-processed content and stay idempotent
 * regardless of pipeline order (trim runs before dedup/eviction).
 */

/** Prefix of a deduped tool output (`strategies.applyDedup`). */
export const DEDUPED_PREFIX = "[deduped: ";

/** Suffix appended by bulk-output eviction (`eviction.evictBulkOutput`). */
export const EVICTED_BULK_SUFFIX = "\n... [evicted bulk output]";

/** Suffix appended by tool-output trimming (`trim.trimToolOutput`). */
export const TRIMMED_MARKER = /\n\.\.\. \[trimmed \d+\/\d+ chars\]$/;
