import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SecretResolver, secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
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
    expect(secretResolver.normalizeForStorage('enc:cHJldmlvdXMtc2VjcmV0')).toMatch(/^v2:/);
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

  it('preserves external references while normalizing engine credential writes', () => {
    expect(secretResolver.normalizeForStorage('ref:EG_ENGINE_PASSWORD')).toBe('ref:EG_ENGINE_PASSWORD');
    expect(secretResolver.normalizeForStorage(null)).toBeNull();
  });

  it('resolves file references only from the configured secret root', () => {
    const root = mkdtempSync(join(tmpdir(), 'enterpriseglue-secret-root-'));
    const secretPath = join(root, 'oidc-client-secret');
    writeFileSync(secretPath, 'file-secret');
    const resolver = new SecretResolver(() => ({ provider: 'file', fileRoot: root }));
    try {
      expect(resolver.resolveStored(`ref:${pathToFileURL(secretPath).toString()}`)).toBe('file-secret');
      expect(() => resolver.resolveStored('ref:file:///etc/passwd')).toThrow('outside EG_CONFIG_SECRET_FILE_ROOT');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
