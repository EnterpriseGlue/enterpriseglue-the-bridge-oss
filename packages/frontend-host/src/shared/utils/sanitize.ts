/**
 * Sanitization utilities for preventing DOM-based XSS and Open Redirect vulnerabilities.
 *
 * Used to validate user-controlled values (URL params, location state, route params)
 * before interpolating them into navigation paths or href attributes.
 */

/**
 * Sanitize a path parameter (ID, slug, etc.) by stripping everything
 * except alphanumeric characters, hyphens, underscores, and dots.
 * Prevents path traversal and injection via crafted IDs.
 */
export function sanitizePathParam(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).replace(/[^a-zA-Z0-9\-_.:]/g, '');
}

/**
 * Validate that a navigation path is safe (relative, no protocol, no double-slash).
 * Returns the path unchanged if safe, otherwise returns the fallback.
 */
export function safeRelativePath(path: string, fallback = '/'): string {
  if (!path) return fallback;
  // Block absolute URLs, protocol-relative URLs, and javascript: URIs
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(path)) return fallback;
  if (path.startsWith('//')) return fallback;
  // Ensure it starts with /
  if (!path.startsWith('/')) return fallback;
  return path;
}
