import { encrypt, isEncrypted, safeDecrypt } from '../encryption.js';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { config } from '@enterpriseglue/shared/config/index.js';

export type StoredSecretKind = 'encrypted_local' | 'external_ref' | 'legacy';

export type SecretResolverSettings = {
  provider: 'env' | 'file' | 'docker';
  fileRoot?: string;
};

export type SecretReferenceAvailability = {
  available: boolean;
  reason?:
    | 'file_provider_not_configured'
    | 'file_outside_root'
    | 'file_unavailable'
    | 'docker_secret_provider_not_configured'
    | 'docker_secret_invalid_name'
    | 'docker_secret_unavailable'
    | 'environment_variable_missing';
};

const DEFAULT_DOCKER_SECRET_ROOT = '/run/secrets';
const DOCKER_SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function isPathWithinRoot(root: string, filePath: string): boolean {
  const pathFromRoot = relative(root, filePath);
  return pathFromRoot !== ''
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

class SecretFileBoundaryError extends Error {
  constructor(readonly kind: 'outside_root' | 'unavailable') {
    super(kind);
  }
}

function resolveRegularSecretFile(rootInput: string, fileInput: string): string {
  const configuredRoot = resolve(rootInput);
  const requestedPath = resolve(fileInput);
  if (!isPathWithinRoot(configuredRoot, requestedPath)) {
    throw new SecretFileBoundaryError('outside_root');
  }

  try {
    const canonicalRoot = realpathSync(configuredRoot);
    if (!statSync(canonicalRoot).isDirectory()) {
      throw new SecretFileBoundaryError('unavailable');
    }

    const canonicalPath = realpathSync(requestedPath);
    if (!isPathWithinRoot(canonicalRoot, canonicalPath)) {
      throw new SecretFileBoundaryError('outside_root');
    }
    if (!statSync(canonicalPath).isFile()) {
      throw new SecretFileBoundaryError('unavailable');
    }
    return canonicalPath;
  } catch (error) {
    if (error instanceof SecretFileBoundaryError) throw error;
    throw new SecretFileBoundaryError('unavailable');
  }
}

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
    if (this.isExternalReference(value)) return value;
    if (value.startsWith('v2:') && !isEncrypted(value)) {
      throw new Error('Encrypted secret value is malformed');
    }
    if (isEncrypted(value)) return value;
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
    if (reference.startsWith('docker://')) {
      const settings = this.settings();
      if (settings.provider !== 'docker') return { available: false, reason: 'docker_secret_provider_not_configured' };
      const name = reference.slice('docker://'.length);
      if (!DOCKER_SECRET_NAME.test(name)) return { available: false, reason: 'docker_secret_invalid_name' };
      try {
        const root = resolve(settings.fileRoot || DEFAULT_DOCKER_SECRET_ROOT);
        const filePath = resolveRegularSecretFile(root, resolve(root, name));
        accessSync(filePath, constants.R_OK);
        return statSync(filePath).size > 0
          ? { available: true }
          : { available: false, reason: 'docker_secret_unavailable' };
      } catch {
        return { available: false, reason: 'docker_secret_unavailable' };
      }
    }

    if (reference.startsWith('file://')) {
      const settings = this.settings();
      if (settings.provider !== 'file' || !settings.fileRoot) return { available: false, reason: 'file_provider_not_configured' };
      try {
        const root = resolve(settings.fileRoot);
        const filePath = resolveRegularSecretFile(root, resolve(fileURLToPath(reference)));
        accessSync(filePath, constants.R_OK);
        return statSync(filePath).size > 0
          ? { available: true }
          : { available: false, reason: 'file_unavailable' };
      } catch (error) {
        if (error instanceof SecretFileBoundaryError && error.kind === 'outside_root') {
          return { available: false, reason: 'file_outside_root' };
        }
        return { available: false, reason: 'file_unavailable' };
      }
    }

    // Bare identifiers remain supported for existing UI-managed providers.
    // Config bundles may use the explicit env:// form documented for CI/CD.
    const environmentVariable = reference.startsWith('env://')
      ? reference.slice('env://'.length)
      : reference;
    return environmentVariable && process.env[environmentVariable]
      ? { available: true }
      : { available: false, reason: 'environment_variable_missing' };
  }

  resolveStored(value: string | null | undefined): string | null {
    if (!value) return null;
    if (this.isExternalReference(value)) {
      const reference = value.slice('ref:'.length);
      if (reference.startsWith('docker://')) {
        const settings = this.settings();
        if (settings.provider !== 'docker') {
          throw new Error('Docker secret references require EG_CONFIG_SECRET_PROVIDER=docker');
        }
        const name = reference.slice('docker://'.length);
        if (!DOCKER_SECRET_NAME.test(name)) {
          throw new Error('Docker secret reference must use docker://<secret-name>');
        }
        const root = resolve(settings.fileRoot || DEFAULT_DOCKER_SECRET_ROOT);
        try {
          const filePath = resolveRegularSecretFile(root, resolve(root, name));
          return readFileSync(filePath, 'utf8');
        } catch {
          throw new Error('Docker secret reference is unavailable');
        }
      }
      if (reference.startsWith('file://')) {
        const settings = this.settings();
        if (settings.provider !== 'file' || !settings.fileRoot) {
          throw new Error('File-backed secret references require EG_CONFIG_SECRET_PROVIDER=file and EG_CONFIG_SECRET_FILE_ROOT');
        }
        const root = resolve(settings.fileRoot);
        let filePath: string;
        try {
          filePath = resolveRegularSecretFile(root, resolve(fileURLToPath(reference)));
        } catch (error) {
          if (error instanceof SecretFileBoundaryError && error.kind === 'outside_root') {
            throw new Error('File-backed secret reference is outside EG_CONFIG_SECRET_FILE_ROOT');
          }
          throw new Error('File-backed secret reference is unavailable');
        }
        if (!isPathWithinRoot(realpathSync(root), filePath)) {
          throw new Error('File-backed secret reference is outside EG_CONFIG_SECRET_FILE_ROOT');
        }
        return readFileSync(filePath, 'utf8');
      }
      const environmentVariable = reference.startsWith('env://')
        ? reference.slice('env://'.length)
        : reference;
      const resolved = environmentVariable ? process.env[environmentVariable] : undefined;
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
