import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/email/config.js', () => ({
  getResendClient: vi.fn(),
}));

describe('email auth service', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
