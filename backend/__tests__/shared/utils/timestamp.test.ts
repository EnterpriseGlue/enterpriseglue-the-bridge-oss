import { describe, it, expect, vi } from 'vitest';
import { now, nowSeconds, msToSeconds, secondsToMs, isExpired, fromNow, Duration } from '@enterpriseglue/shared/utils/timestamp.js';

describe('timestamp utils', () => {
  it('returns current times', () => {
    const base = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(base);
    expect(now()).toBe(base);
    expect(nowSeconds()).toBe(Math.floor(base / 1000));
    vi.restoreAllMocks();
  });

  it('converts ms to seconds and back', () => {
    expect(msToSeconds(5500)).toBe(5);
    expect(secondsToMs(5)).toBe(5000);
  });

  it('checks expiration and fromNow', () => {
    const base = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(base);
    expect(isExpired(base - 1)).toBe(true);
    expect(isExpired(base + 1)).toBe(false);
    expect(fromNow(Duration.MINUTE)).toBe(base + 60_000);
    vi.restoreAllMocks();
  });
});
