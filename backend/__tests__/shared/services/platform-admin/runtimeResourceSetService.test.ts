import { describe, expect, it, vi } from 'vitest';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { runtimeResourceSetService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceSetService.js';

describe('runtimeResourceSetService', () => {
  it('uses the supplied transaction store for create, update, and archive lifecycle writes', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const store = {
      getRepository(entity: unknown) {
        if (entity === RuntimeResourceSet) return { insert, update };
        throw new Error('Unexpected repository');
      },
    };

    const created = await runtimeResourceSetService.create({
      tenantId: 'tenant-a', key: 'payments', name: 'Payments', engineId: 'engine-a', resourceKind: 'process_definition',
      selector: { mode: 'prefix', prefix: 'payments-' }, source: 'config', sourceRef: 'config_bundle:access', ownershipMode: 'config_warn',
    }, store as any);
    await runtimeResourceSetService.update(created.id, {
      name: 'Payments v2', engineId: 'engine-b', resourceKind: 'decision_definition',
      selector: { mode: 'keys', keys: ['payments-risk'] }, runtimeTenantId: 'runtime-a',
      ownershipMode: 'config_locked', sourceHash: 'hash-2', lastAppliedAt: 200, driftStatus: 'in_sync', isArchived: false,
    }, store as any);
    await runtimeResourceSetService.archive(created.id, { sourceHash: 'archive-hash', lastAppliedAt: 300, driftStatus: 'in_sync' }, store as any);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', runtimeResourceSetKeyIdentity: 'tenant-a:payments', source: 'config', ownershipMode: 'config_warn',
    }));
    expect(update).toHaveBeenNthCalledWith(1, { id: created.id }, expect.objectContaining({
      name: 'Payments v2', engineId: 'engine-b', resourceKind: 'decision_definition',
      selectorJson: JSON.stringify({ mode: 'keys', keys: ['payments-risk'] }), selectorFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      runtimeTenantId: 'runtime-a', ownershipMode: 'config_locked', sourceHash: 'hash-2', isArchived: false,
    }));
    expect(update).toHaveBeenNthCalledWith(2, { id: created.id }, expect.objectContaining({
      isArchived: true, sourceHash: 'archive-hash', lastAppliedAt: 300, driftStatus: 'in_sync',
    }));
  });

  it('rejects empty update names before acquiring a data source', async () => {
    await expect(runtimeResourceSetService.update('set-a', { name: '  ' })).rejects.toThrow('Runtime Resource Set name is required');
  });
});
