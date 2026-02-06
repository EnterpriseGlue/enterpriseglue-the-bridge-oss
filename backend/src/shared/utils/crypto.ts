/**
 * Crypto utilities for encrypting/decrypting sensitive data
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { config } from '@shared/config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function parseLegacySalt(): Buffer {
  const raw = process.env.CRYPTO_LEGACY_SCRYPT_SALT;
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('CRYPTO_LEGACY_SCRYPT_SALT is required to decrypt legacy encrypted values');
  }
  const v = raw.trim();
  if (/^[0-9a-fA-F]{64,}$/.test(v) && v.length % 2 === 0) {
    return Buffer.from(v, 'hex');
  }
  return Buffer.from(v, 'utf8');
}

function getEncryptionKey(): Buffer {
  return Buffer.from(config.encryptionKey, 'hex');
}

function deriveKeyV2(_salt: Buffer): Buffer {
  return getEncryptionKey();
}

function deriveKeyLegacy(): Buffer {
  // Legacy decryption: try the current ENCRYPTION_KEY first, then fall back to scrypt derivation
  // for data encrypted with the old secret-based scheme.
  const legacySecret = process.env.CRYPTO_LEGACY_SECRET;
  if (legacySecret && legacySecret.trim().length > 0) {
    return scryptSync(legacySecret.trim(), parseLegacySalt(), 32);
  }
  return getEncryptionKey();
}

/**
 * Encrypt a string value
 */
export function encrypt(plaintext: string): string {
  const salt = randomBytes(32);
  const key = deriveKeyV2(salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format v2: v2:salt:iv:authTag:encryptedData
  return `v2:${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');

  // v2 format
  if (parts.length === 5 && parts[0] === 'v2') {
    const salt = Buffer.from(parts[1], 'hex');
    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const encrypted = parts[4];

    const key = deriveKeyV2(salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const key = deriveKeyLegacy();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
