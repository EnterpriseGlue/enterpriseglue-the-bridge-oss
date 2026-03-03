import { describe, it, expect, vi } from 'vitest';
import { isMicrosoftAuthEnabled } from '@enterpriseglue/shared/services/microsoft.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    microsoftClientId: null,
    microsoftClientSecret: null,
    microsoftTenantId: null,
    microsoftRedirectUri: null,
  },
}));

describe('microsoft service', () => {
  it('returns false when Microsoft auth not configured', () => {
    const result = isMicrosoftAuthEnabled();
    expect(result).toBe(false);
  });
});
