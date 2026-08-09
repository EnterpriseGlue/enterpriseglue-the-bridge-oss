import { describe, expect, it } from 'vitest';
import { EngineBackstopProjectionService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopProjectionService.js';

const service = new EngineBackstopProjectionService();

function context(overrides: Record<string, unknown> = {}) {
  return {
    engineId: 'engine-1',
    engineType: 'camunda7',
    tenancyMode: 'dedicated',
    tenantId: 'tenant-a',
    mappings: [{ authzGroupId: 'group-operators', nativeGroupId: 'camunda-operators', isActive: true }],
    candidates: [{
      sourceAssignmentId: 'assignment-1',
      tenantId: 'tenant-a',
      principal: { type: 'group', id: 'group-operators' },
      permissionIds: ['engine:instance:view'],
      expiresAt: null,
      resource: {
        engineId: 'engine-1',
        kind: 'process_definition',
        key: 'payments',
        tenantId: 'tenant-a',
        isActive: true,
        tenantResolutionStatus: 'resolved',
      },
    }],
    ...overrides,
  };
}

describe('EngineBackstopProjectionService', () => {
  it('projects only an exact mapped group READ grant and de-duplicates compatible sources', () => {
    const projection = service.project(context({
      candidates: [
        ...context().candidates,
        { ...context().candidates[0], sourceAssignmentId: 'assignment-2' },
      ],
    }), 100);

    expect(projection.classifications).toEqual([
      expect.objectContaining({ sourceAssignmentId: 'assignment-1', disposition: 'proposed', reasonCodes: ['exact_group_read_projected'], resourceKind: 'process_definition', resourceKey: 'payments', nativeGroupId: 'camunda-operators', camundaResourceType: 6, permissions: ['READ'] }),
      expect.objectContaining({ sourceAssignmentId: 'assignment-2', disposition: 'proposed' }),
    ]);
    expect(projection.desiredGrants).toEqual([{
      nativeGroupId: 'camunda-operators', resourceKind: 'process_definition', resourceKey: 'payments', camundaResourceType: 6, permissions: ['READ'], sourceAssignmentIds: ['assignment-1', 'assignment-2'],
    }]);
  });

  it('projects exact decision definitions to their Camunda resource type', () => {
    const input = context();
    input.candidates[0].resource = { ...input.candidates[0].resource, kind: 'decision_definition', key: 'credit-score' };
    const projection = service.project(input, 100);
    expect(projection.desiredGrants).toEqual([expect.objectContaining({ resourceKind: 'decision_definition', resourceKey: 'credit-score', camundaResourceType: 10 })]);
  });

  it('projects the same exact grants for an Operaton engine', () => {
    const projection = service.project(context({ engineType: 'operaton' }), 100);
    expect(projection.desiredGrants).toEqual([expect.objectContaining({
      nativeGroupId: 'camunda-operators', resourceKind: 'process_definition', resourceKey: 'payments', camundaResourceType: 6, permissions: ['READ'],
    })]);
  });

  it.each([
    ['non-compatible engine', { engineType: 'ion' }, 'engine_type_not_supported'],
    ['direct user', { candidates: [{ ...context().candidates[0], principal: { type: 'user', id: 'user-1' } }] }, 'principal_not_group'],
    ['missing group map', { mappings: [] }, 'group_mapping_missing'],
    ['ambiguous group map', { mappings: [{ authzGroupId: 'group-operators', nativeGroupId: 'a', isActive: true }, { authzGroupId: 'group-operators', nativeGroupId: 'b', isActive: true }] }, 'group_mapping_ambiguous'],
    ['expired assignment', { candidates: [{ ...context().candidates[0], expiresAt: 100 }] }, 'assignment_expired'],
    ['unsupported permission', { candidates: [{ ...context().candidates[0], permissionIds: ['engine:instance:view', 'engine:deploy'] }] }, 'permission_mapping_not_supported'],
    ['engine-wide scope', { candidates: [{ ...context().candidates[0], resource: null }] }, 'scope_not_resource_specific'],
    ['inactive resource', { candidates: [{ ...context().candidates[0], resource: { ...context().candidates[0].resource, isActive: false } }] }, 'runtime_resource_inactive'],
    ['unresolved resource', { candidates: [{ ...context().candidates[0], resource: { ...context().candidates[0].resource, tenantResolutionStatus: 'unmapped' } }] }, 'runtime_resource_unresolved_tenant'],
    ['unsupported resource kind', { candidates: [{ ...context().candidates[0], resource: { ...context().candidates[0].resource, kind: 'task' } }] }, 'runtime_resource_kind_not_supported'],
  ])('fails closed for %s', (_name, overrides, reasonCode) => {
    const projection = service.project(context(overrides), 100);
    expect(projection.desiredGrants).toEqual([]);
    expect(projection.classifications[0]).toMatchObject({ reasonCodes: [reasonCode] });
  });

  it('requires same-tenant resolved scope for a shared engine', () => {
    const projection = service.project(context({
      tenancyMode: 'shared',
      candidates: [{ ...context().candidates[0], tenantId: 'tenant-a', resource: { ...context().candidates[0].resource, tenantId: 'tenant-b' } }],
    }), 100);
    expect(projection.desiredGrants).toEqual([]);
    expect(projection.classifications[0]).toMatchObject({ disposition: 'blocked', reasonCodes: ['runtime_resource_cross_tenant'] });
  });

  it('rejects a stale cross-tenant runtime resource on a dedicated engine', () => {
    const projection = service.project(context({
      candidates: [{
        ...context().candidates[0],
        tenantId: 'tenant-a',
        resource: { ...context().candidates[0].resource, tenantId: 'tenant-b', tenantResolutionStatus: 'resolved' },
      }],
    }), 100);

    expect(projection.desiredGrants).toEqual([]);
    expect(projection.classifications[0]).toMatchObject({ disposition: 'blocked', reasonCodes: ['runtime_resource_cross_tenant'] });
  });

  it('fails closed on a shared engine when the native resource key is active in another tenant', () => {
    const projection = service.project(context({
      tenancyMode: 'shared',
      candidates: [{
        ...context().candidates[0],
        resource: { ...context().candidates[0].resource, nativeAuthorizationKeyCrossTenant: true },
      }],
    }), 100);

    expect(projection.desiredGrants).toEqual([]);
    expect(projection.classifications[0]).toMatchObject({
      disposition: 'blocked', reasonCodes: ['native_authorization_key_cross_tenant'],
    });
  });
});
