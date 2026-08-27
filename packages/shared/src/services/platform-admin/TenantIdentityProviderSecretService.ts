import { IdentityProvider } from '../../infrastructure/persistence/entities/IdentityProvider.js';
import { Errors } from '../../middleware/errorHandler.js';
import { normalizeIdentityProviderSyncForMandatoryLogin } from '../../schemas/platform-admin/identity.js';
import type { TenantSecretPurpose } from './TenantSecretBroker.js';
import type { EntityManager } from 'typeorm';
import { identityProviderKeyIdentity, identityProviderService, type IdentityProviderInput } from './IdentityProviderService.js';
import { secretResolver, type SecretReferenceAvailability } from './SecretResolver.js';

type SecretFieldContract = {
  protocol: IdentityProvider['protocol'];
  configurationField: string;
};

const SECRET_FIELDS: Record<TenantSecretPurpose, SecretFieldContract> = {
  'oidc.client_secret': { protocol: 'oidc', configurationField: 'clientSecretRef' },
  'saml.metadata_xml': { protocol: 'saml', configurationField: 'metadataXmlRef' },
  'saml.idp_signing_certificate': { protocol: 'saml', configurationField: 'signingCertificateRef' },
  'saml.request_signing_private_key': { protocol: 'saml', configurationField: 'requestSigningPrivateKeyRef' },
  'saml.request_signing_certificate': { protocol: 'saml', configurationField: 'requestSigningCertificateRef' },
  'ldap.bind_password': { protocol: 'ldap', configurationField: 'bindPasswordRef' },
  'ldap.tls_trust_certificate': { protocol: 'ldap', configurationField: 'tlsTrustRef' },
};

export type TenantIdentityProviderSecretMetadata = {
  purpose: TenantSecretPurpose;
  reference: string;
  version: string | null;
  updatedAt: number;
  previousRetired: boolean;
};

function configuration(provider: IdentityProvider): Record<string, unknown> {
  try {
    const parsed = JSON.parse(provider.configurationJson) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw Errors.validation('Identity provider configuration is invalid');
  }
}

function providerInput(provider: IdentityProvider, update: {
  configuration?: Record<string, unknown>;
  isEnabled?: boolean;
}): IdentityProviderInput {
  return {
    tenantId: provider.tenantId,
    key: provider.key,
    displayName: provider.displayName,
    organization: provider.organization,
    displayOrder: provider.displayOrder,
    isPreferred: provider.isPreferred,
    loginDomains: JSON.parse(provider.loginDomainsJson || '[]') as string[],
    protocol: provider.protocol,
    isEnabled: update.isEnabled ?? provider.isEnabled,
    authenticationMode: provider.authenticationMode,
    directoryTenantId: provider.directoryTenantId,
    configuration: update.configuration || configuration(provider),
    sync: normalizeIdentityProviderSyncForMandatoryLogin(JSON.parse(provider.syncJson || '{}')),
    ownershipMode: provider.ownershipMode,
    sourceRef: provider.sourceRef,
    sourceHash: provider.sourceHash,
    lastAppliedAt: provider.lastAppliedAt,
    driftStatus: provider.driftStatus,
  };
}

function contract(provider: IdentityProvider, purpose: TenantSecretPurpose): SecretFieldContract {
  const selected = SECRET_FIELDS[purpose];
  if (selected.protocol !== provider.protocol) {
    throw Errors.validation('Secret purpose does not match the identity provider protocol');
  }
  return selected;
}

function requireTenantId(tenantId: string | null | undefined): string {
  if (!tenantId?.trim()) throw Errors.validation('Tenant-scoped secret administration requires a tenant route');
  return tenantId.trim();
}

function storedReference(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

class TenantIdentityProviderSecretService {
  async setBreakGlassReference(input: {
    tenantId: string;
    providerKey: string;
    purpose: TenantSecretPurpose;
    reference: string;
    enableProvider: boolean;
    store: EntityManager;
  }): Promise<IdentityProvider> {
    const tenantId = requireTenantId(input.tenantId);
    const reference = input.reference.trim();
    if (!reference.startsWith('ref:') || reference.includes('tenant-secret://')) {
      throw Errors.validation('Break-glass recovery requires an environment, file, or Docker secret reference');
    }
    const externalReference = reference.slice('ref:'.length);
    if (!externalReference.startsWith('env://') && !externalReference.startsWith('file://')
      && !externalReference.startsWith('docker://') && !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(externalReference)) {
      throw Errors.validation('Break-glass recovery reference is invalid');
    }
    const availability = secretResolver.checkExternalReference(externalReference);
    if (!availability.available) throw Errors.serviceUnavailable('Break-glass secret reference');
    const provider = await input.store.getRepository(IdentityProvider)
      .findOne({ where: { providerKeyIdentity: identityProviderKeyIdentity(tenantId, input.providerKey) } });
    if (!provider) throw Errors.notFound('Identity provider');
    const selected = contract(provider, input.purpose);
    const currentConfiguration = configuration(provider);
    return identityProviderService.upsert(providerInput(provider, {
      configuration: { ...currentConfiguration, [selected.configurationField]: reference },
      isEnabled: input.enableProvider,
    }), input.store);
  }

  async provision(input: {
    tenantId: string;
    purpose: TenantSecretPurpose;
    value: string;
    correlationId?: string;
  }): Promise<TenantIdentityProviderSecretMetadata> {
    const tenantId = requireTenantId(input.tenantId);
    const metadata = await secretResolver.putTenantSecret(input);
    return {
      purpose: input.purpose,
      reference: `ref:${metadata.reference}`,
      version: metadata.version,
      updatedAt: metadata.updatedAt,
      previousRetired: false,
    };
  }

  async rotateProvider(input: {
    tenantId: string;
    providerKey: string;
    purpose: TenantSecretPurpose;
    value: string;
    correlationId?: string;
  }): Promise<TenantIdentityProviderSecretMetadata> {
    const tenantId = requireTenantId(input.tenantId);
    const provider = await identityProviderService.getByKey(input.providerKey, tenantId);
    if (!provider) throw Errors.notFound('Identity provider');
    if (provider.ownershipMode === 'config_locked') {
      throw Errors.conflict('Config-locked identity provider secrets must be changed through their configuration source');
    }
    const selected = contract(provider, input.purpose);
    const currentConfiguration = configuration(provider);
    const previousReference = storedReference(currentConfiguration[selected.configurationField]);
    const metadata = await secretResolver.putTenantSecret({
      tenantId,
      purpose: input.purpose,
      value: input.value,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(previousReference ? { previousReference } : {}),
    });
    const nextReference = `ref:${metadata.reference}`;
    try {
      await identityProviderService.upsert(providerInput(provider, {
        configuration: { ...currentConfiguration, [selected.configurationField]: nextReference },
      }));
    } catch (error) {
      await secretResolver.retireTenantSecret(nextReference, {
        tenantId,
        purpose: input.purpose,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      }).catch(() => undefined);
      throw error;
    }

    let previousRetired = false;
    if (previousReference?.includes('tenant-secret://')) {
      try {
        previousRetired = (await secretResolver.retireTenantSecret(previousReference, {
          tenantId,
          purpose: input.purpose,
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        })).retired;
      } catch {
        // The provider already points at the successfully stored replacement.
        // Report pending retirement without turning the committed rotation into
        // an ambiguous failure that a caller might retry with another value.
        previousRetired = false;
      }
    }
    return {
      purpose: input.purpose,
      reference: nextReference,
      version: metadata.version,
      updatedAt: metadata.updatedAt,
      previousRetired,
    };
  }

  async availability(input: {
    tenantId: string;
    providerKey: string;
    purpose: TenantSecretPurpose;
    correlationId?: string;
  }): Promise<{ purpose: TenantSecretPurpose; configured: boolean; available: boolean; reason?: string; version?: string | null }> {
    const tenantId = requireTenantId(input.tenantId);
    const provider = await identityProviderService.getByKey(input.providerKey, tenantId);
    if (!provider) throw Errors.notFound('Identity provider');
    const selected = contract(provider, input.purpose);
    const reference = storedReference(configuration(provider)[selected.configurationField]);
    if (!reference) return { purpose: input.purpose, configured: false, available: false, reason: 'not_found' };
    const status = await secretResolver.checkTenantExternalReference(reference, {
      tenantId,
      purpose: input.purpose,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
    const availability = status as SecretReferenceAvailability & { version?: string | null };
    return {
      purpose: input.purpose,
      configured: true,
      available: availability.available,
      ...(availability.reason ? { reason: availability.reason } : {}),
      ...(availability.version !== undefined ? { version: availability.version } : {}),
    };
  }

  async retireProvider(input: {
    tenantId: string;
    providerKey: string;
    purpose: TenantSecretPurpose;
    correlationId?: string;
  }): Promise<{ purpose: TenantSecretPurpose; retired: boolean; retiredAt: number; providerDisabled: true }> {
    const tenantId = requireTenantId(input.tenantId);
    const provider = await identityProviderService.getByKey(input.providerKey, tenantId);
    if (!provider) throw Errors.notFound('Identity provider');
    if (provider.ownershipMode === 'config_locked') {
      throw Errors.conflict('Config-locked identity provider secrets must be changed through their configuration source');
    }
    const selected = contract(provider, input.purpose);
    const reference = storedReference(configuration(provider)[selected.configurationField]);
    if (!reference?.includes('tenant-secret://')) throw Errors.validation('The selected provider secret is not broker-managed');
    // Disable and revoke provider sessions before making the credential
    // unavailable, so an interrupted retirement fails closed.
    await identityProviderService.upsert(providerInput(provider, { isEnabled: false }));
    const result = await secretResolver.retireTenantSecret(reference, {
      tenantId,
      purpose: input.purpose,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
    return { purpose: input.purpose, ...result, providerDisabled: true };
  }

  async retireReference(input: {
    tenantId: string;
    purpose: TenantSecretPurpose;
    reference: string;
    correlationId?: string;
  }): Promise<{ purpose: TenantSecretPurpose; retired: boolean; retiredAt: number }> {
    const tenantId = requireTenantId(input.tenantId);
    const result = await secretResolver.retireTenantSecret(input.reference, {
      tenantId,
      purpose: input.purpose,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
    return { purpose: input.purpose, ...result };
  }
}

export const tenantIdentityProviderSecretService = new TenantIdentityProviderSecretService();
