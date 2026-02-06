/**
 * Encryption Service
 * Handles encryption/decryption of sensitive data like tokens
 */

import crypto from 'crypto';
import { config } from '@shared/config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function parseScryptSaltFromEnv(varName: string): Buffer {
  const raw = process.env[varName];
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`${varName} is required to decrypt legacy encrypted values`);
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
  // Legacy decryption: try scrypt derivation with legacy secret if provided,
  // otherwise use the current ENCRYPTION_KEY directly.
  const legacySecret = process.env.ENCRYPTION_LEGACY_SECRET;
  if (legacySecret && legacySecret.trim().length > 0) {
    const salt = parseScryptSaltFromEnv('ENCRYPTION_LEGACY_JWT_SALT');
    return crypto.scryptSync(legacySecret.trim(), salt, 32);
  }
  return getEncryptionKey();
}

/**
 * Encrypt a string value
 * Returns base64 encoded string: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const salt = crypto.randomBytes(32);
  const key = deriveKeyV2(salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Format v2: v2:salt:iv:authTag:ciphertext
  return `v2:${salt.toString('base64')}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a string value
 * Expects base64 encoded string: iv:authTag:ciphertext
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');

  // v2 format
  if (parts.length === 5 && parts[0] === 'v2') {
    const salt = Buffer.from(parts[1], 'base64');
    const iv = Buffer.from(parts[2], 'base64');
    const authTag = Buffer.from(parts[3], 'base64');
    const ciphertext = parts[4];

    const key = deriveKeyV2(salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // legacy format: iv:authTag:ciphertext
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const key = deriveKeyLegacy();
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Check if a string is encrypted (has our format)
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3 && !(parts.length === 5 && parts[0] === 'v2')) return false;
  
  try {
    // Check if parts are valid base64 (best effort)
    if (parts.length === 5 && parts[0] === 'v2') {
      Buffer.from(parts[1], 'base64');
      Buffer.from(parts[2], 'base64');
      Buffer.from(parts[3], 'base64');
      return true;
    }
    Buffer.from(parts[0], 'base64');
    Buffer.from(parts[1], 'base64');
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely decrypt - returns original value if not encrypted or decryption fails
 */
export function safeDecrypt(value: string): string {
  if (!isEncrypted(value)) {
    return value;
  }
  
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

/**
 * Hash a value (one-way, for comparison)
 */
export function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
