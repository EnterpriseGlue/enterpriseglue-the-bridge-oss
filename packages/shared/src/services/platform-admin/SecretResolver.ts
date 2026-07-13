import { encrypt, isEncrypted, safeDecrypt } from '../encryption.js';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import { config } from '@enterpriseglue/shared/config/index.js';

export type StoredSecretKind = 'encrypted_local' | 'external_ref' | 'legacy';

export type SecretResolverSettings = {
  provider: 'env' | 'file';
  fileRoot?: string;
};

export type SecretReferenceAvailability = {
  available: boolean;
  reason?: 'file_provider_not_configured' | 'file_outside_root' | 'file_unavailable' | 'environment_variable_missing';
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

  /**
   * Checks whether an opaque external reference can be resolved without
   * returning its value. This is safe for config-bundle preflight output.
   */
  checkExternalReference(reference: string): SecretReferenceAvailability {
    if (reference.startsWith('file://')) {
      const settings = this.settings();
      if (settings.provider !== 'file' || !settings.fileRoot) return { available: false, reason: 'file_provider_not_configured' };
      try {
        const root = resolve(settings.fileRoot);
        const filePath = resolve(fileURLToPath(reference));
        const pathFromRoot = relative(root, filePath);
        if (pathFromRoot.startsWith('..') || pathFromRoot === '' || pathFromRoot.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
          return { available: false, reason: 'file_outside_root' };
        }
        accessSync(filePath, constants.R_OK);
        return statSync(filePath).size > 0
          ? { available: true }
          : { available: false, reason: 'file_unavailable' };
      } catch {
        return { available: false, reason: 'file_unavailable' };
      }
    }

    return process.env[reference]
      ? { available: true }
      : { available: false, reason: 'environment_variable_missing' };
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
