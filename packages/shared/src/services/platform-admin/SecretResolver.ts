import { encrypt, isEncrypted, safeDecrypt } from '../encryption.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import { config } from '@enterpriseglue/shared/config/index.js';

export type StoredSecretKind = 'encrypted_local' | 'external_ref' | 'legacy';

export type SecretResolverSettings = {
  provider: 'env' | 'file';
  fileRoot?: string;
};

/**
 * One boundary for credentials used by identity providers and, later, engine
 * connections. Callers persist only the returned ciphertext or opaque ref.
 */
export class SecretResolver {
  constructor(private readonly settings: () => SecretResolverSettings = () => ({
    provider: config.configSecretProvider,
    fileRoot: config.configSecretFileRoot,
  })) {}

  storeEncryptedLocal(plaintext: string): string {
    if (!plaintext) throw new Error('Secret value is required');
    return encrypt(plaintext);
  }

  normalizeForStorage(value: string | null | undefined): string | null {
    if (!value) return null;
    if (this.isExternalReference(value) || isEncrypted(value)) return value;
    // Upgrade the legacy marker on its next write rather than perpetuating it.
    return this.storeEncryptedLocal(this.resolveStored(value) || value);
  }

  isExternalReference(value: string | null | undefined): boolean {
    return Boolean(value && value.startsWith('ref:'));
  }

  kindOf(value: string | null | undefined): StoredSecretKind | null {
    if (!value) return null;
    if (this.isExternalReference(value)) return 'external_ref';
    if (isEncrypted(value)) return 'encrypted_local';
    return 'legacy';
  }

  resolveStored(value: string | null | undefined): string | null {
    if (!value) return null;
    if (this.isExternalReference(value)) {
      const reference = value.slice('ref:'.length);
      if (reference.startsWith('file://')) {
        const settings = this.settings();
        if (settings.provider !== 'file' || !settings.fileRoot) {
          throw new Error('File-backed secret references require EG_CONFIG_SECRET_PROVIDER=file and EG_CONFIG_SECRET_FILE_ROOT');
        }
        const root = resolve(settings.fileRoot);
        const filePath = resolve(fileURLToPath(reference));
        const pathFromRoot = relative(root, filePath);
        if (pathFromRoot.startsWith('..') || pathFromRoot === '' || pathFromRoot.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
          throw new Error('File-backed secret reference is outside EG_CONFIG_SECRET_FILE_ROOT');
        }
        return readFileSync(filePath, 'utf8');
      }
      const resolved = process.env[reference];
      if (!resolved) throw new Error(`External secret reference is unavailable: ${reference}`);
      return resolved;
    }
    if (value.startsWith('enc:')) {
      // Read-only compatibility for the old reversible base64 marker. All
      // writes use AES-GCM through storeEncryptedLocal().
      return Buffer.from(value.slice('enc:'.length), 'base64').toString('utf8');
    }
    return safeDecrypt(value);
  }
}

export const secretResolver = new SecretResolver();
