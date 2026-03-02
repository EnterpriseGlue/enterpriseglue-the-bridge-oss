import { describe, it, expect } from 'vitest';
import { getSafeRedirectUrl } from '@enterpriseglue/shared/utils/safeRedirect.js';

describe('getSafeRedirectUrl', () => {
  it('accepts allowed host and protocol', () => {
    const url = getSafeRedirectUrl('https://app.example.com/path', {
      allowedHosts: ['example.com'],
      allowedProtocols: ['https:'],
    });
    expect(url).toBe('https://app.example.com/path');
  });

  it('rejects disallowed protocol', () => {
    const url = getSafeRedirectUrl('http://example.com', {
      allowedHosts: ['example.com'],
      allowedProtocols: ['https:'],
    });
    expect(url).toBeNull();
  });

  it('rejects disallowed host', () => {
    const url = getSafeRedirectUrl('https://evil.com', {
      allowedHosts: ['example.com'],
    });
    expect(url).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(getSafeRedirectUrl(123, { allowedHosts: ['example.com'] })).toBeNull();
  });
});
