import { describe, expect, it, vi } from 'vitest';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
import { decrypt, isEncrypted } from '@enterpriseglue/shared/services/encryption.js';

describe('SecretResolver', () => {
  it('stores new local values using authenticated encryption', () => {
    const stored = secretResolver.storeEncryptedLocal('provider-secret');

    expect(stored).toMatch(/^v2:/);
    expect(isEncrypted(stored)).toBe(true);
    expect(decrypt(stored)).toBe('provider-secret');
    expect(secretResolver.resolveStored(stored)).toBe('provider-secret');
  });

  it('reads legacy base64 markers without producing them on new writes', () => {
    expect(secretResolver.resolveStored('enc:cHJldmlvdXMtc2VjcmV0')).toBe('previous-secret');
    expect(secretResolver.kindOf('enc:cHJldmlvdXMtc2VjcmV0')).toBe('legacy');
  });

  it('resolves opaque external references without exposing the reference value', () => {
    vi.stubEnv('EG_TEST_PROVIDER_SECRET', 'external-secret');
    try {
      expect(secretResolver.kindOf('ref:EG_TEST_PROVIDER_SECRET')).toBe('external_ref');
      expect(secretResolver.resolveStored('ref:EG_TEST_PROVIDER_SECRET')).toBe('external-secret');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
