import { describe, it, expect, vi } from 'vitest';
import { isGoogleAuthEnabled } from '@enterpriseglue/shared/services/google.js';

vi.mock('@enterpriseglue/shared/services/platform-admin/SsoProviderService.js', () => ({
  ssoProviderService: {
    getProviderByType: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    googleClientId: null,
    googleClientSecret: null,
    googleRedirectUri: null,
  },
}));

describe('google service', () => {
  it('returns false when Google auth not configured', async () => {
    const result = await isGoogleAuthEnabled();
    expect(result).toBe(false);
  });
});
