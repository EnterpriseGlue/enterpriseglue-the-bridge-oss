import { configBundlePreviewService, type ConfigBundlePolicyContext, type ConfigBundlePreviewInput, type ConfigBundleValidationIssue } from './ConfigBundlePreviewService.js';
import { secretResolver, type SecretReferenceAvailability } from './SecretResolver.js';
import { hashCanonicalConfig } from './config-bundle-hash.js';

export interface ConfigBundleSecretReferenceStatus extends SecretReferenceAvailability {
  reference: string;
  locations: string[];
}

export interface ConfigBundleSecretPreflight {
  valid: boolean;
  canonicalHash?: string;
  availabilityHash?: string;
  available: boolean;
  errors: ConfigBundleValidationIssue[];
  references: ConfigBundleSecretReferenceStatus[];
}

function collectSecretReferences(value: unknown, path: string, references: Map<string, string[]>): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectSecretReferences(entry, `${path}.${index}`, references));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const entryPath = `${path}.${key}`;
    if (key.endsWith('Ref') && typeof entry === 'string') {
      references.set(entry, [...(references.get(entry) || []), entryPath]);
      continue;
    }
    collectSecretReferences(entry, entryPath, references);
  }
}

/**
 * Verifies only opaque secret-reference availability for a canonical bundle.
 * It never returns secret bytes and does not mutate configuration or storage.
 */
class ConfigBundleSecretPreflightService {
  check(input: ConfigBundlePreviewInput, policy?: ConfigBundlePolicyContext): ConfigBundleSecretPreflight {
    const compilation = configBundlePreviewService.compile(input, policy);
    if (!compilation.preview.valid || !compilation.files || !compilation.preview.canonicalHash) {
      return {
        valid: false,
        available: false,
        errors: compilation.preview.errors,
        references: [],
      };
    }

    const locationsByReference = new Map<string, string[]>();
    for (const [filePath, file] of Object.entries(compilation.files)) {
      collectSecretReferences(file, filePath, locationsByReference);
    }
    const references = Array.from(locationsByReference.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reference, locations]) => ({
        reference,
        locations: locations.sort(),
        ...secretResolver.checkExternalReference(reference),
      }));

    return {
      valid: true,
      canonicalHash: compilation.preview.canonicalHash,
      availabilityHash: hashCanonicalConfig({
        canonicalHash: compilation.preview.canonicalHash,
        references: references.map(({ reference, available, reason }) => ({ reference, available, reason: reason || null })),
      }),
      available: references.every((reference) => reference.available),
      errors: [],
      references,
    };
  }
}

export const configBundleSecretPreflightService = new ConfigBundleSecretPreflightService();
