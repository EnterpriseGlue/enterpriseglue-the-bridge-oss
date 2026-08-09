import { describe, expect, it } from 'vitest';
import { slugifyIdentifier } from '@enterpriseglue/shared/utils/identifier-slug.js';

describe('slugifyIdentifier', () => {
  it('normalizes separators in one pass', () => {
    expect(slugifyIdentifier('  Engine   Operations / North  ')).toBe('engine-operations-north');
  });

  it('preserves explicitly allowed identifier characters', () => {
    expect(slugifyIdentifier(' Example.System_Key ' , { preserve: '._-' })).toBe('example.system_key');
  });

  it('applies the maximum length without retaining a trailing separator', () => {
    expect(slugifyIdentifier('abcdefghij ---- value', { maxLength: 12 })).toBe('abcdefghij-v');
    expect(slugifyIdentifier('abcdefghij ---- value', { maxLength: 11 })).toBe('abcdefghij');
  });

  it('returns the configured fallback for an empty identifier', () => {
    expect(slugifyIdentifier(' --- ', { fallback: 'role' })).toBe('role');
  });
});
