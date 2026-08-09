import { camundaGet } from '../bpmn-engine-client.js';
import { blindIndex } from '../encryption.js';
import {
  CamundaNativeAuthorizationExportSchema,
  CamundaNativeAuthorizationSchema,
  CamundaNativeGrantClassificationSchema,
  CamundaNativeGrantRuntimeResourceSchema,
  type CamundaNativeAuthorization,
  type CamundaNativeAuthorizationExport,
  type CamundaNativeGrantClassification,
  type CamundaNativeGrantReasonCode,
  type CamundaNativeGrantResourceKind,
  type CamundaNativeGrantRuntimeResource,
} from '../../schemas/platform-admin/camunda-native-grants.js';

export const CAMUNDA_NATIVE_GRANT_MAPPING_CATALOG_VERSION = 'camunda7-v1-read-only';

const CAMUNDA_RESOURCE_KIND_BY_TYPE: Record<string, CamundaNativeGrantResourceKind> = {
  '6': 'process_definition',
  process_definition: 'process_definition',
  processdefinition: 'process_definition',
  '10': 'decision_definition',
  decision_definition: 'decision_definition',
  decisiondefinition: 'decision_definition',
};

const ACTIONS_BY_RESOURCE_PERMISSION: Record<CamundaNativeGrantResourceKind, Record<string, string[]>> = {
  process_definition: {
    READ: ['engine.runtime.process-definitions.read'],
  },
  decision_definition: {
    READ: ['engine.runtime.decisions.read'],
  },
};

export interface CamundaNativeAuthorizationPageRequest {
  firstResult: number;
  maxResults: number;
}

export type CamundaNativeAuthorizationPageReader = (
  engineId: string,
  page: CamundaNativeAuthorizationPageRequest,
) => Promise<unknown>;

export interface CamundaNativeGrantInventory {
  authorizations: CamundaNativeAuthorization[];
  inventoryHash: string;
  truncated: boolean;
}

export interface ClassifyCamundaNativeGrantOptions {
  /** Required for exact-resource proposals; unknown or inactive resources fail closed. */
  runtimeResources?: CamundaNativeGrantRuntimeResource[];
  /** Shared engines require one resource with an already-resolved tenant. */
  requireResolvedTenant?: boolean;
}

/**
 * Camunda's live REST representation can add operational fields (for example
 * removal-time metadata) that are not authorization inputs. Accept those only
 * at the trusted live-transport boundary, then project the narrow canonical
 * authorization shape used for hashing, classification, export, and storage.
 * Customer exports remain strictly versioned through
 * CamundaNativeAuthorizationExportSchema.
 */
const CamundaNativeLiveAuthorizationSchema = CamundaNativeAuthorizationSchema
  .passthrough()
  .transform((authorization) => ({
    id: authorization.id,
    type: authorization.type,
    permissions: authorization.permissions,
    userId: authorization.userId,
    groupId: authorization.groupId,
    resourceType: authorization.resourceType,
    resourceId: authorization.resourceId,
  }));

function parseLiveAuthorizationPage(value: unknown): CamundaNativeAuthorization[] {
  return CamundaNativeLiveAuthorizationSchema.array().parse(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function authorizationSortKey(authorization: CamundaNativeAuthorization): string {
  return `${authorization.id}\u0000${stableJson(authorization)}`;
}

function canonicalAuthorizations(authorizations: CamundaNativeAuthorization[]): CamundaNativeAuthorization[] {
  const byId = new Map<string, CamundaNativeAuthorization>();
  for (const authorization of authorizations) {
    const current = byId.get(authorization.id);
    if (!current || authorizationSortKey(authorization).localeCompare(authorizationSortKey(current)) < 0) {
      byId.set(authorization.id, authorization);
    }
  }
  return [...byId.values()].sort((left, right) => authorizationSortKey(left).localeCompare(authorizationSortKey(right)));
}

function inventoryHash(authorizations: CamundaNativeAuthorization[]): string {
  return blindIndex('camunda-native-inventory-v1', stableJson(authorizations));
}

function normalizeResourceKind(resourceType: CamundaNativeAuthorization['resourceType']): CamundaNativeGrantResourceKind | null {
  const normalized = String(resourceType).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CAMUNDA_RESOURCE_KIND_BY_TYPE[normalized] || null;
}

function result(input: Omit<CamundaNativeGrantClassification, 'reasonCodes'> & { reasonCodes: CamundaNativeGrantReasonCode[] }): CamundaNativeGrantClassification {
  return CamundaNativeGrantClassificationSchema.parse({
    ...input,
    reasonCodes: [...new Set(input.reasonCodes)].sort(),
    mappedActionIds: [...new Set(input.mappedActionIds)].sort(),
  });
}

function actionIdsFor(authorization: CamundaNativeAuthorization, resourceKind: CamundaNativeGrantResourceKind): string[] | null {
  const actionIds = authorization.permissions.flatMap((permission) =>
    ACTIONS_BY_RESOURCE_PERMISSION[resourceKind][permission.trim().toUpperCase()] || [],
  );
  return actionIds.length === authorization.permissions.length ? actionIds : null;
}

/**
 * Classifies one Camunda authorization without persisting or emitting it.
 * Only group READ grants on known process/decision resources are candidates;
 * all other forms remain manual or blocked rather than being broadened.
 */
export function classifyCamundaNativeGrant(
  authorizationInput: CamundaNativeAuthorization,
  options: ClassifyCamundaNativeGrantOptions = {},
): CamundaNativeGrantClassification {
  const authorization = CamundaNativeAuthorizationSchema.parse(authorizationInput);
  const resourceKind = normalizeResourceKind(authorization.resourceType);
  const resourceId = authorization.resourceId || null;
  const principal = authorization.userId
    ? { type: 'user' as const }
    : authorization.groupId
      ? { type: 'group' as const, groupId: authorization.groupId }
      : { type: 'global' as const };
  const base = {
    sourceAuthorizationId: authorization.id,
    principal,
    resourceKind,
    resourceId,
    runtimeTenantId: null,
    mappedActionIds: [],
  };

  if (authorization.type === 0) return result({ ...base, disposition: 'manual_required', reasonCodes: ['global_authorization_not_convertible'] });
  if (authorization.type === 2) return result({ ...base, disposition: 'manual_required', reasonCodes: ['revoke_authorization_not_convertible'] });
  if (authorization.userId) return result({ ...base, disposition: 'manual_required', reasonCodes: ['user_identity_mapping_required'] });
  if (!authorization.groupId) return result({ ...base, disposition: 'manual_required', reasonCodes: ['missing_group_principal'] });
  if (!resourceKind) return result({ ...base, disposition: 'manual_required', reasonCodes: ['unsupported_resource_type'] });

  const mappedActionIds = actionIdsFor(authorization, resourceKind);
  if (!mappedActionIds) return result({ ...base, disposition: 'blocked', reasonCodes: ['permission_mapping_not_supported'] });
  if (!resourceId) return result({ ...base, disposition: 'blocked', reasonCodes: ['missing_resource_id'] });
  if (resourceId === '*') {
    return result({
      ...base,
      disposition: 'approval_required',
      reasonCodes: [resourceKind === 'process_definition' ? 'group_grant_process_definition' : 'group_grant_decision_definition', 'broad_resource_acknowledgement_required'],
      mappedActionIds,
    });
  }

  if (!options.runtimeResources) {
    return result({ ...base, disposition: 'blocked', reasonCodes: ['runtime_resource_inventory_required'] });
  }
  const resources = options.runtimeResources
    .map((resource) => CamundaNativeGrantRuntimeResourceSchema.parse(resource))
    .filter((resource) => resource.isActive && resource.resourceKind === resourceKind && resource.resourceKey === resourceId);
  if (resources.length === 0) return result({ ...base, disposition: 'blocked', reasonCodes: ['runtime_resource_not_found'] });
  if (resources.length !== 1) return result({ ...base, disposition: 'blocked', reasonCodes: ['runtime_resource_ambiguous'] });
  const resource = resources[0];
  if (options.requireResolvedTenant && resource.tenantResolutionStatus !== 'resolved') {
    return result({ ...base, disposition: 'blocked', reasonCodes: ['runtime_resource_unresolved_tenant'] });
  }
  return result({
    ...base,
    disposition: 'proposed',
    reasonCodes: [resourceKind === 'process_definition' ? 'group_grant_process_definition' : 'group_grant_decision_definition'],
    runtimeTenantId: resource.runtimeTenantId || null,
    mappedActionIds,
  });
}

export class CamundaNativeGrantInventoryService {
  constructor(private readonly readPage: CamundaNativeAuthorizationPageReader = (engineId, page) =>
    camundaGet<unknown>(engineId, '/authorization', page)) {}

  /**
   * Reads Camunda 7 authorizations with GET only. The extra one-row read at
   * the configured limit proves whether the bounded inventory is complete.
   */
  async listLive(engineId: string, input: { pageSize?: number; maxRecords?: number } = {}): Promise<CamundaNativeGrantInventory> {
    const pageSize = input.pageSize ?? 100;
    const maxRecords = input.maxRecords ?? 5_000;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('pageSize must be between 1 and 500');
    if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 5_000) throw new Error('maxRecords must be between 1 and 5000');

    const collected: CamundaNativeAuthorization[] = [];
    let firstResult = 0;
    while (collected.length < maxRecords) {
      const maxResults = Math.min(pageSize, maxRecords - collected.length);
      const rawPage = await this.readPage(engineId, { firstResult, maxResults });
      const page = parseLiveAuthorizationPage(rawPage);
      if (page.length > maxResults) throw new Error('Camunda authorization page exceeded requested limit');
      collected.push(...page);
      firstResult += page.length;
      if (page.length < maxResults) break;
    }

    let truncated = false;
    if (collected.length >= maxRecords) {
      const next = parseLiveAuthorizationPage(await this.readPage(engineId, { firstResult, maxResults: 1 }));
      truncated = next.length > 0;
    }
    const authorizations = canonicalAuthorizations(collected);
    return { authorizations, inventoryHash: inventoryHash(authorizations), truncated };
  }

  fromCustomerExport(exportInput: CamundaNativeAuthorizationExport): CamundaNativeGrantInventory {
    const input = CamundaNativeAuthorizationExportSchema.parse(exportInput);
    const authorizations = canonicalAuthorizations(input.authorizations);
    return { authorizations, inventoryHash: inventoryHash(authorizations), truncated: false };
  }
}

export const camundaNativeGrantInventoryService = new CamundaNativeGrantInventoryService();
