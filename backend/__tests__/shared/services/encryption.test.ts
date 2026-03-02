import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, isEncrypted, safeDecrypt, hash } from '@enterpriseglue/shared/services/encryption.js';

describe('encryption service', () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-key-32-chars-minimum-length-required-for-security';
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEnv;
  });

  it('encrypts and decrypts data', () => {
    const plaintext = 'sensitive-data';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain('v2:');
    
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for same input', () => {
    const plaintext = 'test-data';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it('detects encrypted values', () => {
    const encrypted = encrypt('test');
    expect(isEncrypted(encrypted)).toBe(true);
    expect(isEncrypted('plain text')).toBe(false);
  });

  it('safely decrypts valid encrypted data', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext);
    expect(safeDecrypt(encrypted)).toBe(plaintext);
  });

  it('returns original value for non-encrypted data', () => {
    const plaintext = 'not encrypted';
    expect(safeDecrypt(plaintext)).toBe(plaintext);
  });

  it('hashes values one-way', () => {
    const value = 'password123';
    const hashed = hash(value);
    expect(hashed).not.toBe(value);
    expect(hashed).toHaveLength(64);
    expect(hash(value)).toBe(hashed);
  });
});
