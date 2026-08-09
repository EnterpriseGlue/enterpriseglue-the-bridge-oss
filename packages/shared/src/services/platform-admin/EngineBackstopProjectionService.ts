import {
  EngineBackstopClassificationSchema,
  EngineBackstopProjectionContextSchema,
  EngineBackstopProjectionSchema,
  isEngineBackstopNativeAuthorizationEngineType,
  type EngineBackstopClassification,
  type EngineBackstopProjection,
  type EngineBackstopProjectionCandidate,
} from '../../schemas/platform-admin/engine-backstop.js';

/** Shared by Camunda 7 and Operaton's Camunda-compatible authorization REST API. */
const CAMUNDA_COMPATIBLE_RESOURCE_TYPE: Record<'process_definition' | 'decision_definition', 6 | 10> = {
  process_definition: 6,
  decision_definition: 10,
};

const MIRRORABLE_PERMISSIONS = new Set(['engine:instance:view']);

function classification(
  input: Omit<EngineBackstopClassification, 'reasonCodes'> & { reasonCodes: EngineBackstopClassification['reasonCodes'] },
): EngineBackstopClassification {
  return EngineBackstopClassificationSchema.parse({
    ...input,
    reasonCodes: [...new Set(input.reasonCodes)].sort(),
  });
}

function unsupported(candidate: EngineBackstopProjectionCandidate, reason: EngineBackstopClassification['reasonCodes'][number]): EngineBackstopClassification {
  return classification({
    sourceAssignmentId: candidate.sourceAssignmentId,
    principalType: candidate.principal.type,
    disposition: reason === 'principal_not_group' || reason === 'scope_not_resource_specific'
      ? 'manual_required'
      : 'blocked',
    reasonCodes: [reason],
    resourceKind: null,
    resourceKey: null,
    nativeGroupId: null,
    camundaResourceType: null,
    permissions: [],
  });
}

/**
 * Converts fully resolved EnterpriseGlue access candidates into only the exact
 * Camunda-compatible group READ authorizations that v1 can safely own. This class has
 * no persistence or transport dependency, so preview and apply can share the
 * same fail-closed classifier.
 */
export class EngineBackstopProjectionService {
  project(input: unknown, now = Date.now()): EngineBackstopProjection {
    const context = EngineBackstopProjectionContextSchema.parse(input);
    const mappingsByGroup = new Map<string, string[]>();
    for (const mapping of context.mappings.filter((item) => item.isActive)) {
      mappingsByGroup.set(mapping.authzGroupId, [...(mappingsByGroup.get(mapping.authzGroupId) || []), mapping.nativeGroupId]);
    }

    const classifications = context.candidates
      .map((candidate) => this.classify(context, candidate, mappingsByGroup, now))
      .sort((left, right) => left.sourceAssignmentId.localeCompare(right.sourceAssignmentId));
    const grants = new Map<string, { nativeGroupId: string; resourceKind: 'process_definition' | 'decision_definition'; resourceKey: string; camundaResourceType: 6 | 10; sourceAssignmentIds: string[] }>();
    for (const item of classifications) {
      if (item.disposition !== 'proposed' || !item.nativeGroupId || !item.resourceKind || !item.resourceKey || !item.camundaResourceType) continue;
      const key = `${item.nativeGroupId}\u0000${item.resourceKind}\u0000${item.resourceKey}`;
      const existing = grants.get(key) || {
        nativeGroupId: item.nativeGroupId,
        resourceKind: item.resourceKind,
        resourceKey: item.resourceKey,
        camundaResourceType: item.camundaResourceType,
        sourceAssignmentIds: [],
      };
      existing.sourceAssignmentIds.push(item.sourceAssignmentId);
      grants.set(key, existing);
    }

    return EngineBackstopProjectionSchema.parse({
      classifications,
      desiredGrants: [...grants.values()]
        .map((grant) => ({ ...grant, permissions: ['READ'] as const, sourceAssignmentIds: [...new Set(grant.sourceAssignmentIds)].sort() }))
        .sort((left, right) => `${left.nativeGroupId}\u0000${left.resourceKind}\u0000${left.resourceKey}`.localeCompare(`${right.nativeGroupId}\u0000${right.resourceKind}\u0000${right.resourceKey}`)),
    });
  }

  private classify(
    context: ReturnType<typeof EngineBackstopProjectionContextSchema.parse>,
    candidate: EngineBackstopProjectionCandidate,
    mappingsByGroup: Map<string, string[]>,
    now: number,
  ): EngineBackstopClassification {
    if (!isEngineBackstopNativeAuthorizationEngineType(context.engineType)) return unsupported(candidate, 'engine_type_not_supported');
    if (candidate.principal.type !== 'group') return unsupported(candidate, 'principal_not_group');
    if (candidate.expiresAt !== null && candidate.expiresAt <= now) return unsupported(candidate, 'assignment_expired');
    if (candidate.permissionIds.some((permission) => !MIRRORABLE_PERMISSIONS.has(permission))) return unsupported(candidate, 'permission_mapping_not_supported');
    if (!candidate.resource || candidate.resource.engineId !== context.engineId) return unsupported(candidate, 'scope_not_resource_specific');
    const nativeGroups = [...new Set(mappingsByGroup.get(candidate.principal.id) || [])];
    if (nativeGroups.length === 0) return unsupported(candidate, 'group_mapping_missing');
    if (nativeGroups.length !== 1) return unsupported(candidate, 'group_mapping_ambiguous');
    if (!candidate.resource.isActive) return unsupported(candidate, 'runtime_resource_inactive');
    if (candidate.resource.tenantResolutionStatus !== 'resolved') return unsupported(candidate, 'runtime_resource_unresolved_tenant');
    if (context.tenancyMode === 'shared' && (!context.tenantId || candidate.resource.tenantId !== context.tenantId || candidate.tenantId !== context.tenantId)) {
      return unsupported(candidate, 'runtime_resource_cross_tenant');
    }
    if (context.tenancyMode === 'dedicated' && (!context.tenantId || candidate.tenantId !== context.tenantId || candidate.resource.tenantId !== context.tenantId)) {
      return unsupported(candidate, 'runtime_resource_cross_tenant');
    }
    if (context.tenancyMode === 'shared' && candidate.resource.nativeAuthorizationKeyCrossTenant) {
      return unsupported(candidate, 'native_authorization_key_cross_tenant');
    }
    if (candidate.resource.kind !== 'process_definition' && candidate.resource.kind !== 'decision_definition') {
      return unsupported(candidate, 'runtime_resource_kind_not_supported');
    }
    if (!candidate.resource.key.trim()) return unsupported(candidate, 'runtime_resource_key_missing');
    return classification({
      sourceAssignmentId: candidate.sourceAssignmentId,
      principalType: candidate.principal.type,
      disposition: 'proposed',
      reasonCodes: ['exact_group_read_projected'],
      resourceKind: candidate.resource.kind,
      resourceKey: candidate.resource.key,
      nativeGroupId: nativeGroups[0],
      camundaResourceType: CAMUNDA_COMPATIBLE_RESOURCE_TYPE[candidate.resource.kind],
      permissions: ['READ'],
    });
  }
}

export const engineBackstopProjectionService = new EngineBackstopProjectionService();
