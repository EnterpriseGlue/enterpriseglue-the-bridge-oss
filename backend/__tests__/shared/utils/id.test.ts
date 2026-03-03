import { describe, expect, it, vi } from 'vitest';
import { generateId, unixTimestamp, unixTimestampMs } from '@enterpriseglue/shared/utils/id.js';

describe('id utilities', () => {
  it('generates unique IDs in UUID format', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns unix timestamp in seconds', () => {
    const now = Date.now();
    const ts = unixTimestamp();
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(0);
    expect(ts).toBe(Math.floor(now / 1000));
  });

  it('returns unix timestamp in milliseconds', () => {
    const tsMs = unixTimestampMs();
    expect(typeof tsMs).toBe('number');
    expect(tsMs).toBeGreaterThan(0);
    expect(tsMs).toBeGreaterThan(unixTimestamp() * 1000 - 1000);
  });

  it('unixTimestamp uses seconds from Date.now', () => {
    const now = 1_700_000_000_123;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(unixTimestamp()).toBe(Math.floor(now / 1000));
    vi.restoreAllMocks();
  });

  it('unixTimestampMs returns Date.now', () => {
    const now = 1_700_000_000_456;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(unixTimestampMs()).toBe(now);
    vi.restoreAllMocks();
  });
});
