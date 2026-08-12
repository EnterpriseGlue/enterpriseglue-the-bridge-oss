import { describe, expect, it, vi } from 'vitest';
import { AdminConfigObjectOwnership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js';
import {
  AdminConfigObjectOwnershipService,
  adminConfigKeyIdentity,
  adminConfigOwnershipFields,
  adminConfigScopeKey,
  parseAdminConfigSecretReferences,
} from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';
import type { AdminConfigObjectType } from '@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js';

const service = new AdminConfigObjectOwnershipService();

function storeWith(repo: Record<string, ReturnType<typeof vi.fn>>) {
  return { getRepository: vi.fn().mockReturnValue(repo) } as any;
}

function ownership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'owner-1', objectType: 'git_provider', objectId: 'git-1', scopeKey: 'tenant-a',
    configKey: 'git.primary', keyIdentity: 'git_provider:tenant-a:git.primary',
    sourceRef: 'config_bundle:shared-key', ownershipMode: 'config_warn', sourceHash: 'hash-1',
    secretReferencesJson: null, lastAppliedAt: 10, driftStatus: 'in_sync', active: true,
    generation: 4, updatedAt: 10, ...overrides,
  } as any;
}

describe('AdminConfigObjectOwnershipService', () => {
  it('normalizes scope/key identities and returns safe manual defaults', () => {
    expect(adminConfigScopeKey(' tenant-a ')).toBe('tenant-a');
    expect(adminConfigScopeKey(null)).toBe('platform');
    expect(adminConfigKeyIdentity('git_provider', 'tenant-a', 'git.primary'))
      .toBe('git_provider:tenant-a:git.primary');
    expect(adminConfigOwnershipFields(null)).toEqual({
      configKey: null, sourceRef: null, ownershipMode: 'manual', driftStatus: null,
    });
    expect(parseAdminConfigSecretReferences('{"token":"env://TOKEN","ignored":7}'))
      .toEqual({ token: 'env://TOKEN' });
    expect(parseAdminConfigSecretReferences('invalid')).toEqual({});
  });

  it('binds source listings to the normalized tenant scope', async () => {
    const repo = { find: vi.fn().mockResolvedValue([]) };
    await service.listForSource(storeWith(repo), 'config_bundle:shared-key', 'tenant-a', 'git_provider');
    expect(repo.find).toHaveBeenCalledWith({
      where: {
        sourceRef: 'config_bundle:shared-key', scopeKey: 'tenant-a', active: true,
        objectType: 'git_provider',
      },
      order: { objectType: 'ASC', configKey: 'ASC' },
    });
  });

  it('finds only active config-key ownership in the requested scope', async () => {
    const repo = { findOneBy: vi.fn().mockResolvedValue(null) };
    await service.findForConfigKey(storeWith(repo), 'git_provider', 'tenant-b', 'git.primary');
    expect(repo.findOneBy).toHaveBeenCalledWith({
      keyIdentity: 'git_provider:tenant-b:git.primary', active: true,
    });
  });

  it('blocks manual mutation of locked objects without advancing generation', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(ownership({ ownershipMode: 'config_locked' })),
      update: vi.fn(),
    };
    await expect(service.claimManualMutation(storeWith(repo), 'git_provider', 'git-1'))
      .rejects.toThrow('managed by configuration');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('marks warning-owned objects drifted with a generation claim', async () => {
    const current = ownership();
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    await expect(service.claimManualMutation(storeWith(repo), 'git_provider', 'git-1'))
      .resolves.toMatchObject({ generation: 5, driftStatus: 'drifted' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'owner-1', generation: 4, active: true },
      expect.objectContaining({ generation: 5, driftStatus: 'drifted' }),
    );
  });

  for (const objectType of [
    'git_provider', 'email_configuration', 'email_template', 'permission',
    'authorization_policy', 'api_client', 'service_account', 'external_engine_system',
  ] as AdminConfigObjectType[]) {
    it(`marks config_warn ${objectType} ownership drifted before its manual write`, async () => {
      const current = ownership({ objectType, objectId: `${objectType}-1` });
      const repo = {
        findOneBy: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
      };
      await expect(service.claimManualMutation(storeWith(repo), objectType, current.objectId))
        .resolves.toMatchObject({ objectType, generation: 5, driftStatus: 'drifted' });
      expect(repo.findOneBy).toHaveBeenCalledWith({ objectType, objectId: current.objectId, active: true });
    });
  }

  it('fails a concurrent manual claim closed', async () => {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(ownership()),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
    };
    await expect(service.claimManualMutation(storeWith(repo), 'git_provider', 'git-1'))
      .rejects.toThrow('changed; reload and retry');
  });

  it('creates tenant-scoped ownership and stores only present secret references', async () => {
    const repo = {
      find: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const created = await service.claimConfiguration(storeWith(repo), {
      objectType: 'git_provider', objectId: 'git-1', tenantId: 'tenant-a',
      configKey: 'git.primary', sourceRef: 'config_bundle:shared-key',
      ownershipMode: 'config_locked', sourceHash: 'hash-2',
      secretReferences: { token: 'env://TOKEN', empty: null }, appliedAt: 20,
    });
    expect(created).toMatchObject({
      scopeKey: 'tenant-a', keyIdentity: 'git_provider:tenant-a:git.primary',
      generation: 1, active: true, driftStatus: 'in_sync',
      secretReferencesJson: '{"token":"env://TOKEN"}',
    });
    expect(repo.insert).toHaveBeenCalledOnce();
  });

  it('rejects competing bundles and split object/key ownership records', async () => {
    const competingRepo = { find: vi.fn().mockResolvedValue([ownership({ sourceRef: 'config_bundle:other' })]) };
    await expect(service.claimConfiguration(storeWith(competingRepo), {
      objectType: 'git_provider', objectId: 'git-1', tenantId: 'tenant-a', configKey: 'git.primary',
      sourceRef: 'config_bundle:shared-key', ownershipMode: 'config_locked', sourceHash: 'x', appliedAt: 20,
    })).rejects.toThrow('owned by another configuration bundle');

    const splitRepo = { find: vi.fn().mockResolvedValue([ownership(), ownership({ id: 'owner-2', objectId: 'git-2' })]) };
    await expect(service.claimConfiguration(storeWith(splitRepo), {
      objectType: 'git_provider', objectId: 'git-1', tenantId: 'tenant-a', configKey: 'git.primary',
      sourceRef: 'config_bundle:shared-key', ownershipMode: 'config_locked', sourceHash: 'x', appliedAt: 20,
    })).rejects.toThrow('resolve to different ownership records');
  });

  it('rejects stale preview generations before update', async () => {
    const repo = { find: vi.fn().mockResolvedValue([ownership()]), update: vi.fn() };
    await expect(service.claimConfiguration(storeWith(repo), {
      objectType: 'git_provider', objectId: 'git-1', tenantId: 'tenant-a', configKey: 'git.primary',
      sourceRef: 'config_bundle:shared-key', ownershipMode: 'config_locked', sourceHash: 'x',
      appliedAt: 20, expectedGeneration: 3,
    })).rejects.toThrow('changed after preview');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('reconciles warning drift and rejects a lost configuration claim', async () => {
    const repo = { find: vi.fn().mockResolvedValue([ownership()]), update: vi.fn().mockResolvedValue({ affected: 1 }) };
    await expect(service.claimConfiguration(storeWith(repo), {
      objectType: 'git_provider', objectId: 'git-1', tenantId: 'tenant-a', configKey: 'git.primary',
      sourceRef: 'config_bundle:shared-key', ownershipMode: 'config_locked', sourceHash: 'new',
      appliedAt: 20, expectedGeneration: 4,
    })).resolves.toMatchObject({ generation: 5, driftStatus: 'in_sync', ownershipMode: 'config_locked' });

    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.claimConfiguration(storeWith(repo), {
      objectType: 'git_provider', objectId: 'git-1', tenantId: 'tenant-a', configKey: 'git.primary',
      sourceRef: 'config_bundle:shared-key', ownershipMode: 'config_locked', sourceHash: 'new',
      appliedAt: 20, expectedGeneration: 4,
    })).rejects.toThrow('changed after preview');
  });

  it('deactivates only the exact active generation', async () => {
    const repo = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
    await service.deactivateConfiguration(storeWith(repo), ownership(), 30);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'owner-1', generation: 4, active: true },
      { active: false, generation: 5, updatedAt: 30 },
    );
    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.deactivateConfiguration(storeWith(repo), ownership(), 30))
      .rejects.toThrow('changed after preview');
  });

  it('uses the ownership entity repository for object lookups', async () => {
    const repo = { findOneBy: vi.fn().mockResolvedValue(null) };
    const store = storeWith(repo);
    await service.findForObject(store, 'git_provider', 'git-1');
    expect(store.getRepository).toHaveBeenCalledWith(AdminConfigObjectOwnership);
  });
});
