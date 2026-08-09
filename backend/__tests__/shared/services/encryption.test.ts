import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { blindIndex, encrypt, decrypt, isEncrypted, safeDecrypt, hash } from '@enterpriseglue/shared/services/encryption.js';

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

  it('rejects malformed and authenticated-but-tampered versioned ciphertext', () => {
    expect(isEncrypted('v2:not-base64:still:not:ciphertext')).toBe(false);
    expect(() => safeDecrypt('v2:not-base64:still:not:ciphertext')).toThrow('Invalid encrypted');

    const encrypted = encrypt('provider-secret');
    const parts = encrypted.split(':');
    const ciphertext = Buffer.from(parts[4], 'base64');
    ciphertext[0] ^= 1;
    const tampered = [...parts.slice(0, 4), ciphertext.toString('base64')].join(':');
    expect(isEncrypted(tampered)).toBe(true);
    expect(() => safeDecrypt(tampered)).toThrow();
  });

  it('requires canonical legacy structure while retaining valid legacy AES-GCM decryption', () => {
    expect(isEncrypted('foo:bar:baz')).toBe(false);
    expect(isEncrypted('YWJj:ZGVm:Z2hp')).toBe(false);

    const versioned = encrypt('legacy-compatible-secret').split(':');
    const legacy = [versioned[2], versioned[3], versioned[4]].join(':');
    expect(isEncrypted(legacy)).toBe(true);
    expect(decrypt(legacy)).toBe('legacy-compatible-secret');
  });

  it('hashes values one-way', () => {
    const value = 'password123';
    const hashed = hash(value);
    expect(hashed).not.toBe(value);
    expect(hashed).toHaveLength(64);
    expect(hash(value)).toBe(hashed);
  });

  it('uses deterministic domain-separated keyed blind indexes for low-entropy references', () => {
    const first = blindIndex('native-group', 'admins');
    expect(first).toHaveLength(64);
    expect(blindIndex('native-group', 'admins')).toBe(first);
    expect(blindIndex('runtime-resource', 'admins')).not.toBe(first);
    expect(first).not.toBe(hash('admins'));
  });
});
