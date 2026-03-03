import { describe, it, expect } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, PADDING_FACTOR, STATE_COLORS, HIGHLIGHT_STYLES } from '@src/features/shared/components/viewer/viewerConstants';

describe('viewerConstants', () => {
  it('exports zoom configuration', () => {
    expect(MAX_ZOOM).toBeGreaterThan(MIN_ZOOM);
    expect(PADDING_FACTOR).toBeGreaterThan(0);
  });

  it('defines state colors', () => {
    expect(STATE_COLORS).toHaveProperty('active');
    expect(STATE_COLORS).toHaveProperty('incidents');
    expect(STATE_COLORS).toHaveProperty('suspended');
  });

  it('includes highlight styles', () => {
    expect(HIGHLIGHT_STYLES).toContain('.vt-highlight-src');
  });
});
