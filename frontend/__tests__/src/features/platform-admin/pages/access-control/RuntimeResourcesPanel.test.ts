import { describe, expect, it } from 'vitest';
import { formatRuntimeResourceObservedAt } from '@src/features/platform-admin/pages/access-control/RuntimeResourcesPanel';

describe('RuntimeResourcesPanel timestamp presentation', () => {
  it('formats bigint timestamps serialized by the API as strings', () => {
    const timestamp = 1_786_829_336_411;
    expect(formatRuntimeResourceObservedAt(String(timestamp))).toBe(new Date(timestamp).toLocaleString());
  });

  it('uses a readable placeholder for missing or invalid timestamps', () => {
    expect(formatRuntimeResourceObservedAt(undefined)).toBe('-');
    expect(formatRuntimeResourceObservedAt('not-a-timestamp')).toBe('-');
  });
});
