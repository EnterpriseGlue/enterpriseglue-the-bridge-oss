import { describe, expect, it } from 'vitest';
import {
  bigintNumberTransformer,
  normalizeBigIntToSafeNumber,
} from '@enterpriseglue/shared/infrastructure/persistence/transformers/bigintNumber.js';

describe('EngineHealth BIGINT number transformer', () => {
  it.each([
    [1700000000000, 1700000000000],
    ['1700000000001', 1700000000001],
    [1700000000002n, 1700000000002],
  ])('normalizes database value %s without precision loss', (input, expected) => {
    expect(normalizeBigIntToSafeNumber(input)).toBe(expected);
    expect(bigintNumberTransformer.from(input)).toBe(expected);
  });

  it('preserves nullable TypeORM columns', () => {
    expect(bigintNumberTransformer.to(null)).toBeNull();
    expect(bigintNumberTransformer.from(null)).toBeNull();
    expect(bigintNumberTransformer.to(undefined)).toBeUndefined();
    expect(bigintNumberTransformer.from(undefined)).toBeUndefined();
  });

  it.each([
    ['1700.5'],
    [1700.5],
    ['not-a-number'],
    [Number.MAX_SAFE_INTEGER + 1],
    [BigInt(Number.MAX_SAFE_INTEGER) + 1n],
  ])('rejects invalid or unsafe database value %s', (input) => {
    expect(() => normalizeBigIntToSafeNumber(input)).toThrow();
  });
});
