import { describe, it, expect, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/services/email/config.js', () => ({
  getResendClient: vi.fn(),
}));

describe('email contact service', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
