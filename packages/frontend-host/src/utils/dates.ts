/**
 * Date utility functions for consistent date handling across the application
 * 
 * Backend uses Unix timestamps (seconds since epoch)
 * Camunda uses ISO 8601 strings
 * This module provides consistent formatting for both
 */

/**
 * Format a timestamp or ISO string to a localized date/time string
 */
export function formatDateTime(value: number | string | Date | null | undefined): string {
  if (!value) return '-';
  
  const date = typeof value === 'number'
    ? new Date(value * 1000) // Unix timestamp (seconds) to milliseconds
    : new Date(value);
  
  if (isNaN(date.getTime())) return '-';
  
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a timestamp or ISO string to a localized date string (no time)
 */
export function formatDate(value: number | string | Date | null | undefined): string {
  if (!value) return '-';
  
  const date = typeof value === 'number'
    ? new Date(value * 1000)
    : new Date(value);
  
  if (isNaN(date.getTime())) return '-';
  
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a timestamp or ISO string to a relative time string (e.g., "2 hours ago")
 */
export function formatRelativeTime(value: number | string | Date | null | undefined): string {
  if (!value) return '-';
  
  const date = typeof value === 'number'
    ? new Date(value * 1000)
    : new Date(value);
  
  if (isNaN(date.getTime())) return '-';
  
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  
  return formatDate(value);
}

/**
 * Convert a Unix timestamp (seconds) to milliseconds
 */
export function timestampToMs(timestamp: number): number {
  return timestamp * 1000;
}

/**
 * Convert milliseconds to a Unix timestamp (seconds)
 */
export function msToTimestamp(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Get current Unix timestamp (seconds)
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
