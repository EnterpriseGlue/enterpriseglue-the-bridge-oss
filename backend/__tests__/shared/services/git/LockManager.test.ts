import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('LockManager', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
