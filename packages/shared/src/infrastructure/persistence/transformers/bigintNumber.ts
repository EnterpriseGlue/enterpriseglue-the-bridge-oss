import type { ValueTransformer } from 'typeorm';

/**
 * Convert a database BIGINT value to the JavaScript number used by the public
 * contracts. Timestamp values are well inside the safe-integer range, while
 * rejecting wider values prevents silent precision loss.
 */
export function normalizeBigIntToSafeNumber(value: unknown): number {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return value;
    throw new RangeError('Database BIGINT value is not a safe integer');
  }

  if (typeof value === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    throw new RangeError('Database BIGINT value is not a safe integer');
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
    throw new RangeError('Database BIGINT value is not a safe integer');
  }

  throw new TypeError('Database BIGINT value must be an integer number, bigint, or base-10 integer string');
}

export const bigintNumberTransformer: ValueTransformer = {
  to(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    return normalizeBigIntToSafeNumber(value);
  },
  from(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    return normalizeBigIntToSafeNumber(value);
  },
};
