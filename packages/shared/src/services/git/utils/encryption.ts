import { createCipheriv, createDecipheriv, randomBytes, scrypt, createHash } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const ALGORITHM = 'aes-256-gcm';

function getSalt(): Buffer {
  const configured = process.env.GIT_ENCRYPTION_SALT || process.env.ENCRYPTION_SALT;
  if (configured && configured.trim().length > 0) {
    const v = configured.trim();
    if (/^[0-9a-fA-F]{64,}$/.test(v) && v.length % 2 === 0) {
      return Buffer.from(v, 'hex');
    }
    return Buffer.from(v, 'utf8');
  }

  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // Deterministic salt derived from ENCRYPTION_KEY (stable across restarts, no hardcoded constant)
  return createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
}

function getLegacySalt(): Buffer | null {
  const configured = process.env.GIT_ENCRYPTION_LEGACY_SALT;
  if (!configured || configured.trim().length === 0) return null;
  const v = configured.trim();
  if (/^[0-9a-fA-F]{64,}$/.test(v) && v.length % 2 === 0) {
    return Buffer.from(v, 'hex');
  }
  return Buffer.from(v, 'utf8');
}

/**
 * Encrypt a token using AES-256-GCM
 */
export async function encryptToken(token: string): Promise<string> {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  const iv = randomBytes(16);
  const key = (await scryptAsync(process.env.ENCRYPTION_KEY, getSalt(), 32)) as Buffer;
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Return format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a token using AES-256-GCM
 */
export async function decryptToken(encryptedToken: string): Promise<string> {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');
  
  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const attempt = async (salt: Buffer) => {
    const key = (await scryptAsync(process.env.ENCRYPTION_KEY!, salt, 32)) as Buffer;
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  };

  try {
    return await attempt(getSalt());
  } catch {
    const legacySalt = getLegacySalt();
    if (!legacySalt) throw new Error('Failed to decrypt token');
    return await attempt(legacySalt);
  }
}
