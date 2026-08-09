import { describe, expect, it, vi } from 'vitest';
const { camundaGet, blindIndex } = vi.hoisted(() => ({ camundaGet: vi.fn(), blindIndex: vi.fn(() => 'd'.repeat(64)) }));
vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({ camundaGet }));
vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({ blindIndex }));
import {
  CAMUNDA_NATIVE_GRANT_MAPPING_CATALOG_VERSION,
  CamundaNativeGrantInventoryService,
  camundaNativeGrantInventoryService,
  classifyCamundaNativeGrant,
} from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantInventoryService.js';
import type {
  CamundaNativeAuthorization,
  CamundaNativeGrantDisposition,
  CamundaNativeGrantReasonCode,
} from '@enterpriseglue/shared/schemas/platform-admin/camunda-native-grants.js';

const processResource = {
  resourceKind: 'process_definition' as const,
  resourceKey: 'payments-order',
  runtimeTenantId: 'tenant-payments',
  isActive: true,
  tenantResolutionStatus: 'resolved' as const,
};

describe('CamundaNativeGrantInventoryService', () => {
  it('uses only paginated GET-compatible reads, de-duplicates IDs, and creates a stable hash', async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce([
        { id: 'authorization-b', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'payments-order' },
        { id: 'authorization-a', type: 1, permissions: ['READ'], groupId: 'finance', resourceType: 10, resourceId: 'credit-check' },
      ])
      .mockResolvedValueOnce([
        { id: 'authorization-b', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'payments-order' },
      ]);
    const service = new CamundaNativeGrantInventoryService(readPage);

    const result = await service.listLive('engine-1', { pageSize: 2, maxRecords: 5 });

    expect(readPage).toHaveBeenCalledWith('engine-1', { firstResult: 0, maxResults: 2 });
    expect(readPage).toHaveBeenCalledWith('engine-1', { firstResult: 2, maxResults: 2 });
    expect(readPage).toHaveBeenCalledTimes(2);
    expect(result.authorizations.map((authorization) => authorization.id)).toEqual(['authorization-a', 'authorization-b']);
    expect(result.inventoryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(blindIndex).toHaveBeenCalledWith('camunda-native-inventory-v1', expect.stringContaining('authorization-a'));
    expect(result.truncated).toBe(false);
  });

  it('marks an inventory as truncated only after a bounded probe proves there are more records', async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce([{ id: 'a', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'payments-order' }])
      .mockResolvedValueOnce([{ id: 'b', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'another-process' }]);

    const result = await new CamundaNativeGrantInventoryService(readPage).listLive('engine-1', { maxRecords: 1 });

    expect(readPage).toHaveBeenLastCalledWith('engine-1', { firstResult: 1, maxResults: 1 });
    expect(result.truncated).toBe(true);
    expect(result.authorizations).toHaveLength(1);
  });

  it('accepts only the versioned, bounded customer-export format', () => {
    const service = new CamundaNativeGrantInventoryService(vi.fn());
    const result = service.fromCustomerExport({
      apiVersion: 'enterpriseglue.ai/camunda7-native-authorizations/v1',
      authorizations: [{ id: 'a', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 'PROCESS_DEFINITION', resourceId: 'payments-order' }],
    });
    expect(result.truncated).toBe(false);
    expect(() => service.fromCustomerExport({ apiVersion: 'v1', authorizations: [] } as never)).toThrow();
  });

  it('projects operational Camunda live-response fields without relaxing strict customer exports', async () => {
    const authorization = {
      id: 'live-a', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'payments-order',
      removalTime: null, rootProcessInstanceId: null,
    };
    const result = await new CamundaNativeGrantInventoryService(vi.fn().mockResolvedValue([authorization]))
      .listLive('engine-1');

    expect(result.authorizations).toEqual([{
      id: 'live-a', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'payments-order',
      userId: undefined,
    }]);
    expect(() => new CamundaNativeGrantInventoryService(vi.fn()).fromCustomerExport({
      apiVersion: 'enterpriseglue.ai/camunda7-native-authorizations/v1',
      // This is intentionally an untrusted customer export containing live
      // transport-only fields; runtime validation must reject it.
      authorizations: [authorization as any],
    })).toThrow(/unrecognized/i);
  });

  it('uses the audited Camunda GET client when no reader is injected', async () => {
    camundaGet.mockResolvedValueOnce([]);

    const result = await camundaNativeGrantInventoryService.listLive('engine-default');

    expect(camundaGet).toHaveBeenCalledWith('engine-default', '/authorization', { firstResult: 0, maxResults: 100 });
    expect(result).toMatchObject({ authorizations: [], truncated: false });
  });

  it('rejects invalid pagination limits and a server page that exceeds the requested bound', async () => {
    const service = new CamundaNativeGrantInventoryService(vi.fn().mockResolvedValue([
      { id: 'a', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'payments-order' },
      { id: 'b', type: 1, permissions: ['READ'], groupId: 'ops', resourceType: 6, resourceId: 'another-process' },
    ]));

    await expect(service.listLive('engine-1', { pageSize: 0 })).rejects.toThrow('pageSize must be between 1 and 500');
    await expect(service.listLive('engine-1', { maxRecords: 5_001 })).rejects.toThrow('maxRecords must be between 1 and 5000');
    await expect(service.listLive('engine-1', { pageSize: 1 })).rejects.toThrow('Camunda authorization page exceeded requested limit');
  });
});

describe('classifyCamundaNativeGrant', () => {
  it('proposes only an exact group READ grant with a resolved runtime resource', () => {
    const result = classifyCamundaNativeGrant({
      id: 'grant-1', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: 'payments-order',
    }, { runtimeResources: [processResource], requireResolvedTenant: true });

    expect(result).toEqual(expect.objectContaining({
      disposition: 'proposed',
      principal: { type: 'group', groupId: 'operations' },
      resourceKind: 'process_definition',
      runtimeTenantId: 'tenant-payments',
      mappedActionIds: ['engine.runtime.process-definitions.read'],
      reasonCodes: ['group_grant_process_definition'],
    }));
  });

  it('normalizes signed-export resource names and allows a dedicated resource without a runtime tenant', () => {
    const result = classifyCamundaNativeGrant({
      id: 'decision', type: 1, permissions: ['read'], groupId: 'risk', resourceType: 'decision-definition', resourceId: 'credit-check',
    }, {
      runtimeResources: [{ resourceKind: 'decision_definition', resourceKey: 'credit-check', isActive: true }],
    });

    expect(result).toEqual(expect.objectContaining({
      disposition: 'proposed',
      resourceKind: 'decision_definition',
      runtimeTenantId: null,
      mappedActionIds: ['engine.runtime.decisions.read'],
      reasonCodes: ['group_grant_decision_definition'],
    }));
  });

  it('requires an explicit acknowledgement for broad group grants', () => {
    const result = classifyCamundaNativeGrant({
      id: 'grant-all', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 'DECISION_DEFINITION', resourceId: '*',
    });
    expect(result).toEqual(expect.objectContaining({
      disposition: 'approval_required',
      mappedActionIds: ['engine.runtime.decisions.read'],
      reasonCodes: ['broad_resource_acknowledgement_required', 'group_grant_decision_definition'],
    }));
    expect(classifyCamundaNativeGrant({
      id: 'grant-all-process', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: '*',
    }).reasonCodes).toEqual(['broad_resource_acknowledgement_required', 'group_grant_process_definition']);
  });

  const closedFailureCases: Array<[CamundaNativeAuthorization, CamundaNativeGrantDisposition, CamundaNativeGrantReasonCode]> = [
    [{ id: 'user', type: 1, permissions: ['READ'], userId: 'user@example.test', resourceType: 6, resourceId: 'payments-order' }, 'manual_required', 'user_identity_mapping_required'],
    [{ id: 'global', type: 0, permissions: ['READ'], resourceType: 6, resourceId: 'payments-order' }, 'manual_required', 'global_authorization_not_convertible'],
    [{ id: 'revoke', type: 2, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: 'payments-order' }, 'manual_required', 'revoke_authorization_not_convertible'],
    [{ id: 'task', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 7, resourceId: 'task-id' }, 'manual_required', 'unsupported_resource_type'],
    [{ id: 'write', type: 1, permissions: ['CREATE'], groupId: 'operations', resourceType: 6, resourceId: 'payments-order' }, 'blocked', 'permission_mapping_not_supported'],
    [{ id: 'missing-principal', type: 1, permissions: ['READ'], resourceType: 6, resourceId: 'payments-order' }, 'manual_required', 'missing_group_principal'],
    [{ id: 'missing-resource', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6 }, 'blocked', 'missing_resource_id'],
    [{ id: 'missing', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: 'missing' }, 'blocked', 'runtime_resource_inventory_required'],
  ];

  it.each(closedFailureCases)('fails closed for %s', (authorization, disposition, reasonCode) => {
    const result = classifyCamundaNativeGrant(authorization);
    expect(result.disposition).toBe(disposition);
    expect(result.reasonCodes).toEqual([reasonCode]);
  });

  it('blocks an exact resource unless there is exactly one active, resolved inventory item', () => {
    const inactive = classifyCamundaNativeGrant({
      id: 'inactive', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: 'payments-order',
    }, { runtimeResources: [{ ...processResource, isActive: false }] });
    const ambiguous = classifyCamundaNativeGrant({
      id: 'ambiguous', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: 'payments-order',
    }, { runtimeResources: [processResource, { ...processResource, runtimeTenantId: 'tenant-other' }] });
    const unresolved = classifyCamundaNativeGrant({
      id: 'unresolved', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: 'payments-order',
    }, { runtimeResources: [{ ...processResource, tenantResolutionStatus: 'unmapped' }], requireResolvedTenant: true });

    expect(inactive.reasonCodes).toEqual(['runtime_resource_not_found']);
    expect(ambiguous.reasonCodes).toEqual(['runtime_resource_ambiguous']);
    expect(unresolved.reasonCodes).toEqual(['runtime_resource_unresolved_tenant']);
  });

  it('does not require a resolved runtime tenant for a dedicated-engine caller', () => {
    const result = classifyCamundaNativeGrant({
      id: 'dedicated', type: 1, permissions: ['READ'], groupId: 'operations', resourceType: 6, resourceId: 'payments-order',
    }, { runtimeResources: [{ ...processResource, tenantResolutionStatus: 'unmapped' }] });
    expect(result.disposition).toBe('proposed');
  });

  it('keeps the initial mapping catalogue deliberately narrow and versioned', () => {
    expect(CAMUNDA_NATIVE_GRANT_MAPPING_CATALOG_VERSION).toBe('camunda7-v1-read-only');
  });
});
