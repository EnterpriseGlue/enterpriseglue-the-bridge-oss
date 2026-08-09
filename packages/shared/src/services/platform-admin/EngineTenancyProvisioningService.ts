import {
  OSS_DEFAULT_TENANT_ID,
  normalizeTenantIdForPersistence,
} from '../../authz/tenant-scope.js';
import { recordEngineTenancyDefaultFallback } from '../../engine-tenancy/operational-metrics.js';
import { Errors } from '../../middleware/errorHandler.js';
import type {
  EngineTenancyConfiguration,
  EngineTenantMappingStrategy,
  EngineTenantReference,
} from '../../schemas/mission-control/engine.js';

export type EngineTenancyPrincipalType = 'user' | 'api_client' | 'service_account' | 'system';

export interface EngineTenantReferenceResolution {
  tenantId: string;
  tenantKey?: string | null;
  authorized: boolean;
}

export interface EngineTenantReferenceResolver {
  resolve(input: {
    reference: EngineTenantReference;
    requestTenantId: string | null;
    principalType: EngineTenancyPrincipalType;
    principalId: string | null;
  }): Promise<EngineTenantReferenceResolution | null>;
}

export interface EngineTenancyState {
  tenancyMode?: string | null;
  tenantId?: string | null;
  tenantMappingStrategy?: string | null;
  tenantMappingVersion?: number | null;
  tenantResolutionStatus?: string | null;
}

export interface ResolveEngineTenancyInput {
  tenancy?: EngineTenancyConfiguration;
  runtimeAccessScope?: string | null;
  requestTenantId?: string | null;
  principalType: EngineTenancyPrincipalType;
  principalId?: string | null;
  resolver?: EngineTenantReferenceResolver | null;
}

export interface ResolvedEngineTenancy {
  tenancyMode: 'dedicated' | 'shared';
  tenantId: string | null;
  tenantMappingStrategy: EngineTenantMappingStrategy | null;
  tenantMappingVersion: number;
  tenantResolutionStatus: 'ready' | 'incomplete';
  compatibilityDefaulted: boolean;
}

const dedicatedCompatibilityConfiguration: EngineTenancyConfiguration = {
  mode: 'dedicated',
  tenantRef: { type: 'request_context' },
};

function tenancyError(
  code:
    | 'ENGINE_TENANCY_TRANSITION_REQUIRED'
    | 'ENGINE_SHARED_REQUIRES_RESOURCE_AWARE'
    | 'ENGINE_TENANT_REFERENCE_FORBIDDEN',
  message: string,
  status: number,
) {
  return Errors.withCode(code, message, status, 'tenancy');
}

function normalizedExistingState(existing: EngineTenancyState): {
  tenancyMode: string;
  tenantId: string | null;
  tenantMappingStrategy: string | null;
  tenantMappingVersion: number;
  tenantResolutionStatus: string;
} {
  return {
    tenancyMode: existing.tenancyMode || 'dedicated',
    tenantId: normalizeTenantIdForPersistence(existing.tenantId),
    tenantMappingStrategy: existing.tenantMappingStrategy || null,
    tenantMappingVersion: Number(existing.tenantMappingVersion || 0),
    tenantResolutionStatus: existing.tenantResolutionStatus || 'migration_required',
  };
}

async function resolveDedicatedTenant(
  reference: EngineTenantReference,
  input: ResolveEngineTenancyInput,
  onDefaultFallback: () => void,
): Promise<string> {
  const requestTenantId = normalizeTenantIdForPersistence(input.requestTenantId);

  if (input.resolver) {
    const result = await input.resolver.resolve({
      reference,
      requestTenantId,
      principalType: input.principalType,
      principalId: input.principalId || null,
    });
    if (result?.authorized) {
      const resolvedTenantId = normalizeTenantIdForPersistence(result.tenantId);
      if (resolvedTenantId) return resolvedTenantId;
    }
    if (result && !result.authorized) {
      throw tenancyError(
        'ENGINE_TENANT_REFERENCE_FORBIDDEN',
        'The caller is not authorized to provision an engine for the referenced tenant',
        403,
      );
    }
  }

  if (reference.type === 'request_context') {
    if (requestTenantId) return requestTenantId;
    onDefaultFallback();
    return OSS_DEFAULT_TENANT_ID;
  }
  if (reference.type === 'default') {
    return OSS_DEFAULT_TENANT_ID;
  }
  if (reference.type === 'id' && requestTenantId && normalizeTenantIdForPersistence(reference.id) === requestTenantId) {
    return requestTenantId;
  }
  if (reference.type === 'id' && normalizeTenantIdForPersistence(reference.id) === OSS_DEFAULT_TENANT_ID) {
    return OSS_DEFAULT_TENANT_ID;
  }
  if (reference.type === 'key' && ['default', 'tenant.default'].includes(reference.key)) {
    return OSS_DEFAULT_TENANT_ID;
  }

  throw tenancyError(
    'ENGINE_TENANT_REFERENCE_FORBIDDEN',
    'The tenant reference requires an authorized enterprise tenant resolver',
    403,
  );
}

export class EngineTenancyProvisioningService {
  async resolveForCreate(input: ResolveEngineTenancyInput): Promise<ResolvedEngineTenancy> {
    const compatibilityDefaulted = input.tenancy === undefined;
    const tenancy = input.tenancy || dedicatedCompatibilityConfiguration;

    if (tenancy.mode === 'shared') {
      if (input.runtimeAccessScope !== 'resource_aware') {
        throw tenancyError(
          'ENGINE_SHARED_REQUIRES_RESOURCE_AWARE',
          'Shared engines require runtimeAccessScope=resource_aware',
          400,
        );
      }
      return {
        tenancyMode: 'shared',
        tenantId: null,
        tenantMappingStrategy: tenancy.mappingStrategy,
        tenantMappingVersion: 0,
        tenantResolutionStatus: 'incomplete',
        compatibilityDefaulted,
      };
    }

    const tenantId = await resolveDedicatedTenant(
      tenancy.tenantRef || { type: 'request_context' },
      input,
      () => recordEngineTenancyDefaultFallback({
        principalType: input.principalType,
        declaration: compatibilityDefaulted ? 'omitted' : 'explicit_request_context',
      }),
    );
    return {
      tenancyMode: 'dedicated',
      tenantId,
      tenantMappingStrategy: null,
      tenantMappingVersion: 0,
      tenantResolutionStatus: 'ready',
      compatibilityDefaulted,
    };
  }

  async validateUpdate(
    existingInput: EngineTenancyState,
    input: ResolveEngineTenancyInput,
    options: { compatibilityOmissionMeansDedicated?: boolean } = {},
  ): Promise<ResolvedEngineTenancy | null> {
    if (input.tenancy === undefined && !options.compatibilityOmissionMeansDedicated) return null;

    const existing = normalizedExistingState(existingInput);
    const requested = await this.resolveForCreate(input);
    if (existing.tenancyMode !== requested.tenancyMode) {
      throw tenancyError(
        'ENGINE_TENANCY_TRANSITION_REQUIRED',
        'Changing engine tenancy topology requires the dedicated transition workflow',
        409,
      );
    }
    if (
      existing.tenancyMode === 'shared'
      && existing.tenantMappingStrategy !== requested.tenantMappingStrategy
    ) {
      throw tenancyError(
        'ENGINE_TENANCY_TRANSITION_REQUIRED',
        'Changing a shared-engine mapping strategy requires the dedicated transition workflow',
        409,
      );
    }
    if (
      existing.tenancyMode === 'dedicated'
      && existing.tenantId
      && existing.tenantId !== requested.tenantId
    ) {
      throw tenancyError(
        'ENGINE_TENANCY_TRANSITION_REQUIRED',
        'Moving a dedicated engine to another tenant requires the dedicated transition workflow',
        409,
      );
    }

    return {
      ...requested,
      tenantMappingVersion: existing.tenantMappingVersion,
      compatibilityDefaulted: input.tenancy === undefined,
    };
  }
}

export const engineTenancyProvisioningService = new EngineTenancyProvisioningService();
