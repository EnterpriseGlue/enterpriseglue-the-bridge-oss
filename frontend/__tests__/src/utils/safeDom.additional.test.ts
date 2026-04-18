import { describe, it, expect } from 'vitest';
import { toSafeDownloadFilename, toSafeHttpUrl, toSafeImageSrc } from '@src/utils/safeDom';

describe('safeDom utils additional', () => {
  describe('toSafeDownloadFilename', () => {
    it('sanitizes filename with special characters', () => {
      expect(toSafeDownloadFilename('file:name?.txt', 'fallback.txt')).toBe('file_name_.txt');
      expect(toSafeDownloadFilename('file\\path/name.txt', 'fallback.txt')).toBe('file_path_name.txt');
    });

    it('removes control characters', () => {
      expect(toSafeDownloadFilename('file\x00name.txt', 'fallback.txt')).toBe('file_name.txt');
    });

    it('preserves regular spaces (only control chars become underscores)', () => {
      // Unified with backend ZIP archive rule: spaces are valid in filenames
      // on every major OS and modern browsers handle them in a.download.
      expect(toSafeDownloadFilename('my file name.txt', 'fallback.txt')).toBe('my file name.txt');
    });

    it('truncates long filenames', () => {
      const longName = 'a'.repeat(250) + '.txt';
      const result = toSafeDownloadFilename(longName, 'fallback.txt');
      expect(result.length).toBeLessThanOrEqual(200);
    });

    it('uses fallback for non-string values', () => {
      expect(toSafeDownloadFilename(null, 'fallback.txt')).toBe('fallback.txt');
      expect(toSafeDownloadFilename(undefined, 'fallback.txt')).toBe('fallback.txt');
      expect(toSafeDownloadFilename(123, 'fallback.txt')).toBe('fallback.txt');
    });
  });

  describe('toSafeHttpUrl', () => {
    it('accepts valid HTTP URLs', () => {
      expect(toSafeHttpUrl('http://example.com')).toBe('http://example.com/');
      expect(toSafeHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    });

    it('rejects non-HTTP protocols', () => {
      expect(toSafeHttpUrl('javascript:alert(1)')).toBeNull();
      expect(toSafeHttpUrl('data:text/html,<script>')).toBeNull();
      expect(toSafeHttpUrl('ftp://example.com')).toBeNull();
    });

    it('rejects non-string values', () => {
      expect(toSafeHttpUrl(null)).toBeNull();
      expect(toSafeHttpUrl(123)).toBeNull();
      expect(toSafeHttpUrl({})).toBeNull();
    });

    it('rejects malformed URLs', () => {
      expect(toSafeHttpUrl('not a url')).toBeNull();
      expect(toSafeHttpUrl('htp://broken')).toBeNull();
    });
  });

  describe('toSafeImageSrc', () => {
    it('accepts valid data URIs', () => {
      const validDataUri = 'data:image/png;base64,iVBORw0KGgo=';
      expect(toSafeImageSrc(validDataUri)).toBe(validDataUri);
    });

    it('rejects protocol-relative URLs', () => {
      expect(toSafeImageSrc('//example.com/image.png')).toBeNull();
    });

    it('rejects non-image data URIs', () => {
      expect(toSafeImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    });

    it('rejects non-string values', () => {
      expect(toSafeImageSrc(null)).toBeNull();
      expect(toSafeImageSrc(123)).toBeNull();
    });

    it('rejects empty strings', () => {
      expect(toSafeImageSrc('')).toBeNull();
      expect(toSafeImageSrc('   ')).toBeNull();
    });
  });
});
