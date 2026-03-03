import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from '@enterpriseglue/shared/utils/crypto.js';

describe('crypto utils additional', () => {
  const originalEnv = {
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET,
  };

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long-minimum-for-security';
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEnv.ENCRYPTION_KEY;
    process.env.ENCRYPTION_SECRET = originalEnv.ENCRYPTION_SECRET;
  });

  it('encrypts and decrypts data with v2 format', () => {
    const plaintext = 'sensitive data';
    const encrypted = encrypt(plaintext);
    
    expect(encrypted).toContain('v2:');
    expect(encrypted).not.toBe(plaintext);
    
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces unique ciphertexts for same plaintext', () => {
    const plaintext = 'test data';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(plaintext);
    expect(decrypt(enc2)).toBe(plaintext);
  });

  it('handles empty string encryption', () => {
    const encrypted = encrypt('');
    expect(encrypted).toContain('v2:');
    expect(decrypt(encrypted)).toBe('');
  });

  it('handles special characters', () => {
    const special = 'test@#$%^&*()_+-={}[]|\\:";\'<>?,./`~';
    const encrypted = encrypt(special);
    expect(decrypt(encrypted)).toBe(special);
  });

  it('handles unicode characters', () => {
    const unicode = '你好世界 🚀 émojis';
    const encrypted = encrypt(unicode);
    expect(decrypt(encrypted)).toBe(unicode);
  });
});
