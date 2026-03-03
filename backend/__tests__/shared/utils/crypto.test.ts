import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt } from '@enterpriseglue/shared/utils/crypto.js';

describe('crypto utils', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-secret-for-encryption-32-chars-min';
    delete process.env.ENCRYPTION_KEY;
    delete process.env.CRYPTO_LEGACY_SECRET;
    delete process.env.CRYPTO_LEGACY_SCRYPT_SALT;
  });

  it('encrypts and decrypts values with v2 format', () => {
    const value = 'hello-world';
    const encrypted = encrypt(value);
    expect(encrypted.startsWith('v2:')).toBe(true);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(value);
  });

  it('throws on invalid format', () => {
    expect(() => decrypt('bad-format')).toThrow('Invalid encrypted data format');
  });
});
