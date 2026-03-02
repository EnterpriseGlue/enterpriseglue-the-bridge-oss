import { describe, expect, it } from 'vitest';
import {
  createApiError,
  nullToUndefined,
  toOptionalTimestamp,
  toTimestamp,
  undefinedToNull,
} from '@enterpriseglue/shared/utils/schema-helpers.js';

describe('schema helpers', () => {
  it('converts timestamps safely', () => {
    expect(toTimestamp(null)).toBe(0);
    expect(toTimestamp(undefined)).toBe(0);
    expect(toTimestamp('123')).toBe(123);
    expect(toTimestamp(456n)).toBe(456);

    expect(toOptionalTimestamp(null)).toBeUndefined();
    expect(toOptionalTimestamp(undefined)).toBeUndefined();
    expect(toOptionalTimestamp('789')).toBe(789);
  });

  it('converts null/undefined consistently', () => {
    expect(nullToUndefined('value')).toBe('value');
    expect(nullToUndefined(null)).toBeUndefined();
    expect(undefinedToNull(undefined)).toBeNull();
    expect(undefinedToNull('value')).toBe('value');
  });

  it('creates api error payloads with optional fields', () => {
    expect(createApiError('InvalidInput', 'Message')).toEqual({
      error: 'InvalidInput',
      message: 'Message',
    });

    expect(createApiError('InvalidInput', 'Message', { field: 'name' }, 'Hint')).toEqual({
      error: 'InvalidInput',
      message: 'Message',
      details: { field: 'name' },
      hint: 'Hint',
    });
  });
});
