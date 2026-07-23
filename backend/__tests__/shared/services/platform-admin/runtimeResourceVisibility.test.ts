import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('PermissionService.getVisibleRuntimeResources', () => {
  afterEach(() => vi.restoreAllMocks());

  // AUTHZ_EVALUATOR_INVARIANT_MATRIX
  // These generated cases protect the core visibility invariant: changing an
  // evaluator decision can only add or remove that exact inventoried resource;
  // it must never expose a sibling resource by accident.
  for (const scenario of [
    { name: 'denies every inventoried resource', allowedIds: [] },
    { name: 'returns only a sparse exact-resource grant', allowedIds: ['resource-2'] },
    { name: 'returns every resource when each exact-resource check allows it', allowedIds: ['resource-1', 'resource-2', 'resource-3'] },
  ]) {
    it(`preserves exact resource isolation when it ${scenario.name}`, async () => {
      const rows = ['resource-1', 'resource-2', 'resource-3'].map((id) => ({
        id,
        engineId: 'engine-1',
        resourceKind: 'process_definition',
        resourceKey: id,
        isActive: true,
      }));
      const find = vi.fn().mockResolvedValue(rows);
      (getDataSource as unknown as Mock).mockResolvedValue({
        getRepository: () => ({ find }),
      });
      const evaluate = vi.spyOn(permissionService, 'evaluatePermission').mockImplementation(async (_permission, context) => ({
        allowed: scenario.allowedIds.includes(String(context.resourceId)),
        reason: 'matrix',
        sources: [],
      }));

      const visible = await permissionService.getVisibleRuntimeResources({
        userId: 'user-1',
        tenantId: 'tenant-a',
        engineId: 'engine-1',
        resourceKind: 'process_definition',
        permission: 'engine:instance:view',
      });

      expect(visible.map((resource) => resource.id)).toEqual(scenario.allowedIds);
      expect(evaluate).toHaveBeenCalledTimes(rows.length);
      for (const [index, resource] of rows.entries()) {
        expect(evaluate).toHaveBeenNthCalledWith(index + 1, 'engine:instance:view', {
          userId: 'user-1',
          tenantId: 'tenant-a',
          resourceType: 'engine_runtime_resource',
          resourceId: resource.id,
        });
      }
      const [query] = find.mock.calls[0];
      expect(query).toMatchObject({ take: 501 });
      expect(query.where).toEqual(expect.arrayContaining([
        expect.objectContaining({
          engineId: 'engine-1',
          resourceKind: 'process_definition',
          isActive: true,
          tenantId: 'tenant-a',
          tenantResolutionStatus: 'resolved',
        }),
      ]));
    });
  }

  it('returns only inventoried resources with an allowed evaluator decision', async () => {
    const rows = [
      { id: 'resource-1', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'payments-order', isActive: true },
      { id: 'resource-2', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'hr-onboard', isActive: true },
    ];
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === RuntimeResource) return { find: vi.fn().mockResolvedValue(rows) };
        throw new Error('Unexpected repository');
      },
    });
    vi.spyOn(permissionService, 'evaluatePermission').mockImplementation(async (_permission, context) => ({
      allowed: context.resourceId === 'resource-1', reason: 'test', sources: [],
    }));

    const visible = await permissionService.getVisibleRuntimeResources({
      userId: 'user-1', tenantId: 'tenant-a', engineId: 'engine-1', resourceKind: 'process_definition', permission: 'engine:instance:view',
    });

    expect(visible.map((resource) => resource.id)).toEqual(['resource-1']);
  });

  it('fails closed instead of evaluating an unbounded inventory result', async () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({ id: `resource-${index}`, engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: String(index), isActive: true }));
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => ({ find: vi.fn().mockResolvedValue(rows) }) });
    await expect(permissionService.getVisibleRuntimeResources({
      userId: 'user-1', engineId: 'engine-1', resourceKind: 'process_definition', permission: 'engine:instance:view', limit: 1,
    })).rejects.toThrow('bounded result set');
  });
});
