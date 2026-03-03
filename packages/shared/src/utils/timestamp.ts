/**
 * Timestamp Utility Functions
 * Standardizes timestamp format across the application
 * All timestamps are stored as milliseconds since Unix epoch (bigint in DB)
 */

/**
 * Get current timestamp in milliseconds (standard format)
 */
export function now(): number {
  return Date.now();
}

/**
 * Get current timestamp in seconds (for legacy compatibility)
 * @deprecated Use now() instead - prefer milliseconds
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Convert milliseconds to seconds
 */
export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Convert seconds to milliseconds
 */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Check if a timestamp (in ms) has expired
 */
export function isExpired(timestampMs: number): boolean {
  return Date.now() > timestampMs;
}

/**
 * Get a timestamp N milliseconds from now
 */
export function fromNow(durationMs: number): number {
  return Date.now() + durationMs;
}

/**
 * Duration constants in milliseconds
 */
export const Duration = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;
