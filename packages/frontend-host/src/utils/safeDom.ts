import {
  buildStarbaseFileName,
  sanitizeFileNameSegment,
} from '@enterpriseglue/shared/utils/starbase-filenames.js';

/**
 * Browser-safe filename sanitiser. Thin wrapper around the shared
 * `sanitizeFileNameSegment` so the frontend uses the same rule as backend
 * ZIP archive entries and individual-file download responses.
 */
export function toSafeDownloadFilename(value: unknown, fallback: string): string {
  return sanitizeFileNameSegment(value, fallback);
}

/**
 * Produce a download filename that ends with the given extension. Delegates
 * to the shared `buildStarbaseFileName` helper with `forceExtension` so that
 * an input already ending in any recognised diagram extension
 * (`.bpmn|.dmn|.form|.xml|.pdf|.svg|.png`) gets its extension replaced
 * rather than doubled.
 */
export function toSafeDownloadFilenameWithExtension(
  value: unknown,
  extension: string,
  fallbackBase = 'download',
): string {
  const normalizedExtension = String(extension || '').trim().replace(/^\.+/, '').toLowerCase();
  const safeFallbackBase = String(fallbackBase || 'download').trim() || 'download';

  if (!normalizedExtension) {
    return sanitizeFileNameSegment(value, safeFallbackBase);
  }

  return buildStarbaseFileName(value, null, {
    forceExtension: normalizedExtension,
    fallbackBase: safeFallbackBase,
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function toSafeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function toSafeImageSrc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return null;

  if (raw.startsWith('data:')) {
    const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const mime = match[1].toLowerCase();
    const base64 = match[2].replace(/\s+/g, '');

    const allowedMimes = new Set([
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif',
      'image/svg+xml',
    ]);
    if (!allowedMimes.has(mime)) return null;

    if (mime === 'image/svg+xml') {
      try {
        const decoded = atob(base64);
        const snippet = decoded.slice(0, 5000).toLowerCase();
        if (
          snippet.includes('<script') ||
          snippet.includes('onload=') ||
          snippet.includes('javascript:') ||
          snippet.includes('<foreignobject')
        ) {
          return null;
        }
      } catch {
        return null;
      }
    }

    return raw;
  }

  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
