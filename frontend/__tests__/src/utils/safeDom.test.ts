import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toSafeDownloadFilename, toSafeDownloadFilenameWithExtension, toSafeHttpUrl, toSafeImageSrc, downloadBlob } from '@src/utils/safeDom';

describe('safeDom utils', () => {
  describe('toSafeDownloadFilename', () => {
    it('sanitizes filenames with slashes', () => {
      expect(toSafeDownloadFilename('bad/name', 'fallback')).toBe('bad_name');
      expect(toSafeDownloadFilename('bad\\name', 'fallback')).toBe('bad_name');
    });

    it('sanitizes filenames with special characters', () => {
      expect(toSafeDownloadFilename('file:name', 'fallback')).toBe('file_name');
      expect(toSafeDownloadFilename('file*name', 'fallback')).toBe('file_name');
      expect(toSafeDownloadFilename('file?name', 'fallback')).toBe('file_name');
      expect(toSafeDownloadFilename('file"name', 'fallback')).toBe('file_name');
      expect(toSafeDownloadFilename('file<name>', 'fallback')).toBe('file_name_');
      expect(toSafeDownloadFilename('file|name', 'fallback')).toBe('file_name');
    });

    it('sanitizes control characters', () => {
      expect(toSafeDownloadFilename('file\x00name', 'fallback')).toBe('file_name');
      expect(toSafeDownloadFilename('file\x1Fname', 'fallback')).toBe('file_name');
      expect(toSafeDownloadFilename('file\x7Fname', 'fallback')).toBe('file_name');
    });

    it('replaces multiple spaces with single underscore', () => {
      expect(toSafeDownloadFilename('file   name', 'fallback')).toBe('file_name');
      // Tab and newline are treated as separate whitespace characters
      expect(toSafeDownloadFilename('file\t\nname', 'fallback')).toBe('file__name');
    });

    it('trims whitespace', () => {
      expect(toSafeDownloadFilename('  filename  ', 'fallback')).toBe('filename');
    });

    it('truncates long filenames to 200 characters', () => {
      const longName = 'a'.repeat(250);
      const result = toSafeDownloadFilename(longName, 'fallback');
      expect(result.length).toBe(200);
    });

    it('uses fallback for empty strings', () => {
      expect(toSafeDownloadFilename('', 'fallback')).toBe('fallback');
      expect(toSafeDownloadFilename('   ', 'fallback')).toBe('fallback');
    });

    it('uses fallback for non-string values', () => {
      expect(toSafeDownloadFilename(null, 'fallback')).toBe('fallback');
      expect(toSafeDownloadFilename(undefined, 'fallback')).toBe('fallback');
      expect(toSafeDownloadFilename(123, 'fallback')).toBe('fallback');
    });

    it('uses "download" as default fallback', () => {
      expect(toSafeDownloadFilename('', '')).toBe('download');
      expect(toSafeDownloadFilename(null, '')).toBe('download');
    });

    it('handles edge case where sanitization results in underscores', () => {
      // Slashes and asterisks are replaced with underscores, not removed
      expect(toSafeDownloadFilename('///', 'fallback')).toBe('___');
      expect(toSafeDownloadFilename('***', 'fallback')).toBe('___');
    });
  });

  describe('toSafeDownloadFilenameWithExtension', () => {
    it('appends the required extension when it is missing', () => {
      expect(toSafeDownloadFilenameWithExtension('Process Diagram', 'bpmn', 'diagram')).toBe('Process_Diagram.bpmn');
    });

    it('preserves the required extension when it is already present', () => {
      expect(toSafeDownloadFilenameWithExtension('Decision Table.dmn', 'dmn', 'diagram')).toBe('Decision_Table.dmn');
    });

    it('replaces xml with the required extension', () => {
      expect(toSafeDownloadFilenameWithExtension('Process.xml', 'bpmn', 'diagram')).toBe('Process.bpmn');
    });

    it('sanitizes slashes while preserving the required extension', () => {
      expect(toSafeDownloadFilenameWithExtension('Folder/Process', 'bpmn', 'diagram')).toBe('Folder_Process.bpmn');
      expect(toSafeDownloadFilenameWithExtension('Folder\\Decision', 'dmn', 'diagram')).toBe('Folder_Decision.dmn');
    });
  });

  describe('downloadBlob', () => {
    it('exports downloadBlob function', () => {
      // Skip detailed test due to jsdom limitations with URL.createObjectURL
      expect(downloadBlob).toBeDefined();
      expect(typeof downloadBlob).toBe('function');
    });
  });

  describe('toSafeHttpUrl', () => {
    it('validates https URLs', () => {
      expect(toSafeHttpUrl('https://example.com')).toBe('https://example.com/');
      expect(toSafeHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    });

    it('validates http URLs', () => {
      expect(toSafeHttpUrl('http://example.com')).toBe('http://example.com/');
    });

    it('rejects javascript: protocol', () => {
      expect(toSafeHttpUrl('javascript:alert(1)')).toBeNull();
    });

    it('rejects data: protocol', () => {
      expect(toSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    });

    it('rejects file: protocol', () => {
      expect(toSafeHttpUrl('file:///etc/passwd')).toBeNull();
    });

    it('rejects non-string values', () => {
      expect(toSafeHttpUrl(null)).toBeNull();
      expect(toSafeHttpUrl(undefined)).toBeNull();
      expect(toSafeHttpUrl(123)).toBeNull();
      expect(toSafeHttpUrl({})).toBeNull();
    });

    it('rejects invalid URLs', () => {
      expect(toSafeHttpUrl('not a url')).toBeNull();
      expect(toSafeHttpUrl('://invalid')).toBeNull();
    });
  });

  describe('toSafeImageSrc', () => {
    it('allows safe data:image URLs', () => {
      expect(toSafeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
      expect(toSafeImageSrc('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
      expect(toSafeImageSrc('data:image/jpg;base64,AAAA')).toBe('data:image/jpg;base64,AAAA');
      expect(toSafeImageSrc('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
      expect(toSafeImageSrc('data:image/gif;base64,AAAA')).toBe('data:image/gif;base64,AAAA');
    });

    it('allows safe SVG data URLs without scripts', () => {
      const safeSvg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');
      expect(toSafeImageSrc(`data:image/svg+xml;base64,${safeSvg}`)).toBe(`data:image/svg+xml;base64,${safeSvg}`);
    });

    it('rejects SVG with script tags', () => {
      const maliciousSvg = btoa('<svg><script>alert(1)</script></svg>');
      expect(toSafeImageSrc(`data:image/svg+xml;base64,${maliciousSvg}`)).toBeNull();
    });

    it('rejects SVG with onload attributes', () => {
      const maliciousSvg = btoa('<svg onload="alert(1)"></svg>');
      expect(toSafeImageSrc(`data:image/svg+xml;base64,${maliciousSvg}`)).toBeNull();
    });

    it('rejects SVG with javascript: URLs', () => {
      const maliciousSvg = btoa('<svg><a href="javascript:alert(1)"></a></svg>');
      expect(toSafeImageSrc(`data:image/svg+xml;base64,${maliciousSvg}`)).toBeNull();
    });

    it('rejects SVG with foreignObject', () => {
      const maliciousSvg = btoa('<svg><foreignObject><body></body></foreignObject></svg>');
      expect(toSafeImageSrc(`data:image/svg+xml;base64,${maliciousSvg}`)).toBeNull();
    });

    it('rejects invalid base64 in SVG', () => {
      expect(toSafeImageSrc('data:image/svg+xml;base64,!!invalid!!')).toBeNull();
    });

    it('rejects non-image MIME types', () => {
      expect(toSafeImageSrc('data:text/html;base64,AAAA')).toBeNull();
      expect(toSafeImageSrc('data:application/javascript;base64,AAAA')).toBeNull();
    });

    it('rejects malformed data URLs', () => {
      expect(toSafeImageSrc('data:image/png,AAAA')).toBeNull(); // missing base64
      expect(toSafeImageSrc('data:image/png;AAAA')).toBeNull(); // malformed
    });

    it('allows http/https image URLs', () => {
      expect(toSafeImageSrc('https://example.com/image.png')).toBe('https://example.com/image.png');
      expect(toSafeImageSrc('http://example.com/image.jpg')).toBe('http://example.com/image.jpg');
    });

    it('rejects protocol-relative URLs', () => {
      expect(toSafeImageSrc('//example.com/image.png')).toBeNull();
    });

    it('rejects javascript: URLs', () => {
      expect(toSafeImageSrc('javascript:alert(1)')).toBeNull();
    });

    it('rejects non-string values', () => {
      expect(toSafeImageSrc(null)).toBeNull();
      expect(toSafeImageSrc(undefined)).toBeNull();
      expect(toSafeImageSrc(123)).toBeNull();
      expect(toSafeImageSrc({})).toBeNull();
    });

    it('rejects empty strings', () => {
      expect(toSafeImageSrc('')).toBeNull();
      expect(toSafeImageSrc('   ')).toBeNull();
    });

    it('handles relative URLs by resolving against origin', () => {
      const result = toSafeImageSrc('/images/test.png');
      expect(result).toContain('/images/test.png');
    });

    it('handles strings that become relative URLs', () => {
      // Strings without protocol are resolved as relative URLs against window.location.origin
      const result = toSafeImageSrc('not a valid url');
      expect(result).toContain('not%20a%20valid%20url');
    });

    it('handles base64 with whitespace', () => {
      const base64WithSpaces = 'AAAA\n  BBBB\t  CCCC';
      expect(toSafeImageSrc(`data:image/png;base64,${base64WithSpaces}`)).toBe(`data:image/png;base64,${base64WithSpaces}`);
    });
  });
});
