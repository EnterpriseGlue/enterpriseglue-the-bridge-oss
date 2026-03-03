import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/services/authorization.js', () => ({
  AuthorizationService: {},
}));

describe('requirePermission middleware', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
