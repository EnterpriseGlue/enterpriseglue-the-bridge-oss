import { describe, it, expect, beforeEach } from 'vitest';
import { encryptToken, decryptToken } from '@enterpriseglue/shared/services/git/utils/encryption.js';

describe('git encryption utils', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-minimum';
    delete process.env.GIT_ENCRYPTION_SALT;
    delete process.env.GIT_ENCRYPTION_LEGACY_SALT;
    delete process.env.ENCRYPTION_SALT;
  });

  it('encrypts and decrypts tokens', async () => {
    const token = 'token-123';
    const encrypted = await encryptToken(token);
    expect(encrypted).toContain(':');
    const decrypted = await decryptToken(encrypted);
    expect(decrypted).toBe(token);
  });

  it('throws on invalid format', async () => {
    await expect(decryptToken('bad')).rejects.toThrow('Invalid encrypted token format');
  });
});
