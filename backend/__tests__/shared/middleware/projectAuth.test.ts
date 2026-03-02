import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasProjectAccess: vi.fn(),
  },
}));

describe('projectAuth middleware', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
