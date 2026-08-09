/**
 * Encryption Service
 * Handles encryption/decryption of sensitive data like tokens
 */

import crypto from 'crypto';
import { config } from '@enterpriseglue/shared/config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SCRYPT_SALT_LENGTH = 32;

function decodeCanonicalBase64(value: string, label: string, expectedLength?: number): Buffer {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Invalid encrypted ${label}`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new Error(`Invalid encrypted ${label}`);
  }
  return decoded;
}

function parseEncryptedValue(value: string): {
  version: 'v2' | 'legacy';
  salt?: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: string;
} {
  const parts = value.split(':');
  if (parts.length === 5 && parts[0] === 'v2') {
    const ciphertext = parts[4];
    decodeCanonicalBase64(ciphertext, 'ciphertext');
    return {
      version: 'v2',
      salt: decodeCanonicalBase64(parts[1], 'salt', SCRYPT_SALT_LENGTH),
      iv: decodeCanonicalBase64(parts[2], 'initialization vector', IV_LENGTH),
      authTag: decodeCanonicalBase64(parts[3], 'authentication tag', AUTH_TAG_LENGTH),
      ciphertext,
    };
  }
  if (parts.length === 3) {
    const ciphertext = parts[2];
    decodeCanonicalBase64(ciphertext, 'ciphertext');
    return {
      version: 'legacy',
      iv: decodeCanonicalBase64(parts[0], 'initialization vector', IV_LENGTH),
      authTag: decodeCanonicalBase64(parts[1], 'authentication tag', AUTH_TAG_LENGTH),
      ciphertext,
    };
  }
  throw new Error('Invalid encrypted data format');
}

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
  const parsed = parseEncryptedValue(encryptedData);

  // v2 format
  if (parsed.version === 'v2') {
    const key = deriveKeyV2(parsed.salt!);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, parsed.iv);
    decipher.setAuthTag(parsed.authTag);

    let decrypted = decipher.update(parsed.ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  const key = deriveKeyLegacy();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, parsed.iv);
  decipher.setAuthTag(parsed.authTag);
  
  let decrypted = decipher.update(parsed.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Check if a string is encrypted (has our format)
 */
export function isEncrypted(value: string): boolean {
  try {
    parseEncryptedValue(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decrypts recognized ciphertext and returns plaintext values unchanged.
 * Authentication or structure failures for versioned ciphertext fail closed.
 */
export function safeDecrypt(value: string): string {
  if (!value.startsWith('v2:') && !isEncrypted(value)) {
    return value;
  }
  return decrypt(value);
}

/**
 * Hash a value (one-way, for comparison)
 */
export function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Deterministic, domain-separated blind index for low-entropy identifiers that
 * must be comparable without exposing a dictionary-verifiable plain hash.
 */
export function blindIndex(domain: string, value: string): string {
  const normalizedDomain = domain.trim();
  if (!normalizedDomain) throw new Error('Blind-index domain is required');
  return crypto.createHmac('sha256', getEncryptionKey())
    .update(normalizedDomain, 'utf8')
    .update('\u0000', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}
