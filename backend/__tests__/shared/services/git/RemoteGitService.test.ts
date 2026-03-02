import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('RemoteGitService', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
