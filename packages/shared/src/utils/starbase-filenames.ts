/**
 * Shared Starbase filename utilities.
 *
 * These helpers produce deterministic, safe, cross-platform filenames for
 * Starbase file downloads (individual XML, PDF, ZIP archive entries, ZIP
 * archive names). Backend routes and frontend download flows must use these
 * helpers to guarantee the filename a user sees is consistent across
 * individual file download, ZIP archive entries, and future export formats
 * (e.g. PDF).
 *
 * Design rules (keep in sync with docs and tests):
 *
 * 1. `sanitizeFileNameSegment(name, fallback)` produces a path-segment-safe
 *    string: strips ASCII control chars, path separators, Windows-reserved
 *    chars; collapses internal whitespace to `_`; trims and caps length.
 *    Empty or meaningless input falls back to the provided fallback.
 *
 * 2. `buildStarbaseFileName(name, type, opts?)`:
 *    - If `opts.forceExtension` is provided, the output always ends with
 *      `.${forceExtension}`. Any recognised existing diagram-ish extension
 *      (`.bpmn`, `.dmn`, `.form`, `.xml`, `.pdf`, `.svg`, `.png`) on the
 *      input name is replaced with the forced extension.
 *    - Otherwise, the output ends with `.${type}` when `type` is non-empty.
 *      If the input already ends with the correct `.${type}` (case-insensitive),
 *      no duplicate extension is appended. Any *other* diagram-ish extension
 *      is kept as-is (i.e. we only de-duplicate the intended type, we do not
 *      rewrite `foo.bpmn` to `foo.dmn`).
 *    - When `type` is empty/undefined and no `forceExtension` is given, the
 *      name is returned through the sanitiser unchanged (no extension added).
 *
 * 3. The returned value is always a single path segment (no slashes) and
 *    safe to use both as a ZIP archive entry name and a browser
 *    `Content-Disposition`/`a.download` filename.
 */

/** File extensions Starbase considers "diagram-ish" and therefore eligible for
 *  extension replacement when a different explicit extension is forced. */
const DIAGRAM_EXTENSION_PATTERN = /\.(bpmn|dmn|form|xml|pdf|svg|png)$/i;

const MAX_FILENAME_LENGTH = 200;

export interface BuildStarbaseFileNameOptions {
  /**
   * Force the output to end with this extension. Leading dots are stripped.
   * When provided, any trailing diagram-ish extension on the input name is
   * replaced; otherwise the forced extension is appended.
   */
  forceExtension?: string;
  /**
   * Fallback base used when the sanitized input is empty. Defaults to
   * `'diagram'`. The final extension rule still applies to the fallback.
   */
  fallbackBase?: string;
}

/**
 * Sanitize a single filesystem/path-segment string. Never returns an empty
 * string: empty or meaningless input (`.`, `..`, whitespace-only) falls back
 * to the provided fallback value.
 */
export function sanitizeFileNameSegment(name: unknown, fallback: string): string {
  const raw = typeof name === 'string' ? name : '';
  // Whitespace handling rules:
  //   - Outer whitespace is trimmed.
  //   - ASCII control characters (including TAB, LF, CR) are replaced with
  //     underscores because they are never valid in filenames.
  //   - Regular spaces are PRESERVED so filenames like "My Process.bpmn"
  //     remain readable. This matches the prior backend ZIP rule and modern
  //     browser/download-attribute support.
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, '_')
    .replace(/[\\/]/g, '_')
    .replace(/[:*?"<>|]/g, '_')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);

  if (!cleaned || cleaned === '.' || cleaned === '..' || /^_+$/.test(cleaned)) {
    const safeFallback = String(fallback || '').trim();
    return safeFallback || 'download';
  }

  return cleaned;
}

function normalizeExtension(extension: unknown): string {
  return String(extension || '')
    .trim()
    .replace(/^\.+/, '')
    .toLowerCase();
}

/**
 * Build a deterministic, safe filename for a Starbase file/download.
 * See file header for the full rule set.
 */
export function buildStarbaseFileName(
  name: unknown,
  type: unknown,
  opts: BuildStarbaseFileNameOptions = {},
): string {
  const fallbackBase = String(opts.fallbackBase || 'diagram').trim() || 'diagram';
  const normalizedType = normalizeExtension(type);
  const forcedExtension = normalizeExtension(opts.forceExtension);
  const desiredExtension = forcedExtension || normalizedType;

  const raw = typeof name === 'string' ? name.trim() : '';
  const effective = raw || fallbackBase;

  let candidate = effective;

  if (desiredExtension) {
    const desiredSuffix = `.${desiredExtension}`;
    const lowerCandidate = candidate.toLowerCase();
    if (lowerCandidate.endsWith(desiredSuffix)) {
      // Already ends with the desired extension — no change needed.
    } else if (forcedExtension && DIAGRAM_EXTENSION_PATTERN.test(candidate)) {
      candidate = candidate.replace(DIAGRAM_EXTENSION_PATTERN, desiredSuffix);
    } else {
      candidate = `${candidate}${desiredSuffix}`;
    }
  }

  const fallbackWithExt = desiredExtension
    ? `${fallbackBase}.${desiredExtension}`
    : fallbackBase;

  return sanitizeFileNameSegment(candidate, fallbackWithExt);
}
