import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SecretResolver, secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
import { decrypt, isEncrypted } from '@enterpriseglue/shared/services/encryption.js';

describe('SecretResolver', () => {
  it('stores new local values using authenticated encryption', () => {
    const plaintext = 'provider-secret-sentinel';
    const stored = secretResolver.storeEncryptedLocal(plaintext);

    expect(stored).toMatch(/^v2:/);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain(plaintext);
    expect(JSON.stringify({ stored })).not.toContain(plaintext);
    expect(decrypt(stored)).toBe(plaintext);
    expect(secretResolver.resolveStored(stored)).toBe(plaintext);
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

  it('checks external reference availability without returning its secret value', () => {
    const plaintext = 'external-provider-secret-sentinel';
    vi.stubEnv('EG_TEST_PROVIDER_SECRET', plaintext);
    try {
      const available = secretResolver.checkExternalReference('EG_TEST_PROVIDER_SECRET');
      const missing = secretResolver.checkExternalReference('EG_TEST_MISSING_SECRET');
      expect(available).toEqual({ available: true });
      expect(missing).toEqual({ available: false, reason: 'environment_variable_missing' });
      expect(JSON.stringify({ available, missing })).not.toContain(plaintext);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('supports documented env:// references while retaining bare environment names', () => {
    vi.stubEnv('EG_TEST_PROVIDER_SECRET', 'external-secret');
    try {
      expect(secretResolver.checkExternalReference('env://EG_TEST_PROVIDER_SECRET')).toEqual({ available: true });
      expect(secretResolver.resolveStored('ref:env://EG_TEST_PROVIDER_SECRET')).toBe('external-secret');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('preserves external references while normalizing engine credential writes', () => {
    expect(secretResolver.normalizeForStorage('ref:EG_ENGINE_PASSWORD')).toBe('ref:EG_ENGINE_PASSWORD');
    expect(secretResolver.normalizeForStorage(null)).toBeNull();
  });

  it('encrypts colon-shaped plaintext and rejects malformed versioned ciphertext', () => {
    const colonPlaintext = 'foo:bar:baz';
    const stored = secretResolver.normalizeForStorage(colonPlaintext)!;
    expect(stored).toMatch(/^v2:/);
    expect(stored).not.toBe(colonPlaintext);
    expect(secretResolver.resolveStored(stored)).toBe(colonPlaintext);
    expect(() => secretResolver.normalizeForStorage('v2:not-base64:still:not:ciphertext')).toThrow('malformed');
  });

  it('does not accept malformed legacy-looking values as encrypted credentials', () => {
    const malformedLegacy = 'YWJj:ZGVm:Z2hp';
    expect(isEncrypted(malformedLegacy)).toBe(false);
    const stored = secretResolver.normalizeForStorage(malformedLegacy)!;
    expect(stored).toMatch(/^v2:/);
    expect(secretResolver.resolveStored(stored)).toBe(malformedLegacy);
  });

  it('fails closed when recognized authenticated ciphertext is tampered', () => {
    const parts = secretResolver.storeEncryptedLocal('provider-secret').split(':');
    const ciphertext = Buffer.from(parts[4], 'base64');
    ciphertext[0] ^= 1;
    const tampered = [...parts.slice(0, 4), ciphertext.toString('base64')].join(':');
    expect(isEncrypted(tampered)).toBe(true);
    expect(() => secretResolver.resolveStored(tampered)).toThrow();
  });

  it('resolves file references only from the configured secret root', () => {
    const root = mkdtempSync(join(tmpdir(), 'enterpriseglue-secret-root-'));
    const secretPath = join(root, 'oidc-client-secret');
    writeFileSync(secretPath, 'file-secret');
    const resolver = new SecretResolver(() => ({ provider: 'file', fileRoot: root }));
    try {
      expect(resolver.checkExternalReference(pathToFileURL(secretPath).toString())).toEqual({ available: true });
      expect(resolver.checkExternalReference('file:///etc/passwd')).toEqual({ available: false, reason: 'file_outside_root' });
      expect(resolver.resolveStored(`ref:${pathToFileURL(secretPath).toString()}`)).toBe('file-secret');
      expect(() => resolver.resolveStored('ref:file:///etc/passwd')).toThrow('outside EG_CONFIG_SECRET_FILE_ROOT');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves bounded Docker secret names only from the configured mount root', () => {
    const root = mkdtempSync(join(tmpdir(), 'enterpriseglue-docker-secret-root-'));
    const secretPath = join(root, 'oidc-client-secret');
    writeFileSync(secretPath, 'docker-secret');
    const resolver = new SecretResolver(() => ({ provider: 'docker', fileRoot: root }));
    const fileResolver = new SecretResolver(() => ({ provider: 'file', fileRoot: root }));
    try {
      expect(resolver.checkExternalReference('docker://oidc-client-secret')).toEqual({ available: true });
      expect(resolver.resolveStored('ref:docker://oidc-client-secret')).toBe('docker-secret');
      expect(resolver.checkExternalReference('docker://../outside')).toEqual({ available: false, reason: 'docker_secret_invalid_name' });
      expect(resolver.checkExternalReference('docker://missing')).toEqual({ available: false, reason: 'docker_secret_unavailable' });
      expect(fileResolver.checkExternalReference('docker://oidc-client-secret')).toEqual({ available: false, reason: 'docker_secret_provider_not_configured' });
      expect(() => resolver.resolveStored('ref:docker://../outside')).toThrow('docker://<secret-name>');
      expect(() => fileResolver.resolveStored('ref:docker://oidc-client-secret')).toThrow('EG_CONFIG_SECRET_PROVIDER=docker');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects file references that escape the configured root through a symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'enterpriseglue-secret-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'enterpriseglue-outside-secret-'));
    const outsideSecret = join(outsideRoot, 'secret');
    const linkedSecret = join(root, 'linked-secret');
    writeFileSync(outsideSecret, 'must-not-be-read');
    symlinkSync(outsideSecret, linkedSecret);
    const resolver = new SecretResolver(() => ({ provider: 'file', fileRoot: root }));
    try {
      const reference = pathToFileURL(linkedSecret).toString();
      expect(resolver.checkExternalReference(reference)).toEqual({ available: false, reason: 'file_outside_root' });
      expect(() => resolver.resolveStored(`ref:${reference}`)).toThrow('outside EG_CONFIG_SECRET_FILE_ROOT');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects Docker secret symlinks that resolve outside the configured root', () => {
    const root = mkdtempSync(join(tmpdir(), 'enterpriseglue-docker-secret-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'enterpriseglue-outside-secret-'));
    const outsideSecret = join(outsideRoot, 'secret');
    writeFileSync(outsideSecret, 'must-not-be-read');
    symlinkSync(outsideSecret, join(root, 'oidc-client-secret'));
    const resolver = new SecretResolver(() => ({ provider: 'docker', fileRoot: root }));
    try {
      expect(resolver.checkExternalReference('docker://oidc-client-secret'))
        .toEqual({ available: false, reason: 'docker_secret_unavailable' });
      expect(() => resolver.resolveStored('ref:docker://oidc-client-secret')).toThrow('unavailable');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each(['file', 'docker'] as const)('supports in-root projected-volume rotation symlinks for %s secrets', (provider) => {
    const root = mkdtempSync(join(tmpdir(), 'enterpriseglue-projected-secret-root-'));
    const versionedDirectory = join(root, '..2026_08_09_01');
    mkdirSync(versionedDirectory);
    writeFileSync(join(versionedDirectory, 'oidc-client-secret'), 'projected-secret');
    symlinkSync('..2026_08_09_01', join(root, '..data'));
    symlinkSync(join('..data', 'oidc-client-secret'), join(root, 'oidc-client-secret'));
    const resolver = new SecretResolver(() => ({ provider, fileRoot: root }));
    const reference = provider === 'file'
      ? pathToFileURL(join(root, 'oidc-client-secret')).toString()
      : 'docker://oidc-client-secret';
    try {
      expect(resolver.checkExternalReference(reference)).toEqual({ available: true });
      expect(resolver.resolveStored(`ref:${reference}`)).toBe('projected-secret');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
