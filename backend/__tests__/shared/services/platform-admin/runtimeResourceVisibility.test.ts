import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('PermissionService.getVisibleRuntimeResources', () => {
  afterEach(() => vi.restoreAllMocks());

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
