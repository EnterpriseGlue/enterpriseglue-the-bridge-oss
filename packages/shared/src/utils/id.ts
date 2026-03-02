import { randomUUID } from 'crypto';

/**
 * Generate a unique ID using UUID v4
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Get current Unix timestamp in seconds
 */
export function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Get current Unix timestamp in milliseconds
 */
export function unixTimestampMs(): number {
  return Date.now();
}
