import { describe, expect, it, vi } from 'vitest';
import { PlatformSettingsSectionOwnership } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettingsSectionOwnership.js';
import { PlatformSettingsSectionOwnershipService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsSectionOwnershipService.js';

const service = new PlatformSettingsSectionOwnershipService();

function storeWith(repo: Record<string, ReturnType<typeof vi.fn>>) {
  return { getRepository: vi.fn().mockReturnValue(repo) } as any;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'default:branding', settingsId: 'default', section: 'branding', scopeKey: 'tenant-a',
    sourceRef: 'config_bundle:shared-key', ownershipMode: 'config_warn', sourceHash: 'old',
    lastAppliedAt: 10, driftStatus: 'in_sync', generation: 3, updatedAt: 10, ...overrides,
  } as any;
}

describe('PlatformSettingsSectionOwnershipService', () => {
  it('lists normalized section ownership state', async () => {
    const repo = { find: vi.fn().mockResolvedValue([row({ scopeKey: '', generation: 'invalid' })]) };
    await expect(service.list(storeWith(repo))).resolves.toEqual([expect.objectContaining({
      section: 'branding', scopeKey: 'platform', generation: 0,
    })]);
  });

  it('blocks locked portal mutations before any generation write', async () => {
    const repo = {
      find: vi.fn().mockResolvedValue([row({ ownershipMode: 'config_locked' })]),
      update: vi.fn(),
    };
    await expect(service.claimManualMutation(storeWith(repo), ['branding']))
      .rejects.toThrow('managed by configuration');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('marks warning-owned sections drifted and advances each claimed generation', async () => {
    const repo = {
      find: vi.fn().mockResolvedValue([row(), row({ id: 'default:pii', section: 'pii', generation: 7 })]),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    await service.claimManualMutation(storeWith(repo), ['branding', 'pii', 'branding']);
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'default:branding', generation: 3 },
      expect.objectContaining({ generation: 4, driftStatus: 'drifted' }),
    );
  });

  it('fails a concurrent manual section claim closed', async () => {
    const repo = { find: vi.fn().mockResolvedValue([row()]), update: vi.fn().mockResolvedValue({ affected: 0 }) };
    await expect(service.claimManualMutation(storeWith(repo), ['branding']))
      .rejects.toThrow('changed; reload and retry');
  });

  it('creates missing sections with the exact configuration scope', async () => {
    const repo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn().mockResolvedValue(undefined) };
    await service.claimConfiguration(storeWith(repo), {
      sections: ['branding', 'branding'], scopeKey: 'tenant-a', sourceRef: 'config_bundle:shared-key',
      ownershipMode: 'config_locked', sourceHash: 'new', appliedAt: 20,
    });
    expect(repo.insert).toHaveBeenCalledOnce();
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'default:branding', scopeKey: 'tenant-a', sourceRef: 'config_bundle:shared-key',
      generation: 1, driftStatus: 'in_sync',
    }));
  });

  it('rejects the same bundle key from a sibling scope', async () => {
    const repo = { find: vi.fn().mockResolvedValue([row({ scopeKey: 'tenant-b' })]), update: vi.fn() };
    await expect(service.claimConfiguration(storeWith(repo), {
      sections: ['branding'], scopeKey: 'tenant-a', sourceRef: 'config_bundle:shared-key',
      ownershipMode: 'config_locked', sourceHash: 'new', appliedAt: 20,
    })).rejects.toThrow('owned by another configuration bundle');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('enforces preview generation and compare-and-swap on updates', async () => {
    const repo = { find: vi.fn().mockResolvedValue([row()]), update: vi.fn().mockResolvedValue({ affected: 1 }) };
    await expect(service.claimConfiguration(storeWith(repo), {
      sections: ['branding'], scopeKey: 'tenant-a', sourceRef: 'config_bundle:shared-key',
      ownershipMode: 'config_locked', sourceHash: 'new', appliedAt: 20, expectedGeneration: 2,
    })).rejects.toThrow('changed after preview');
    expect(repo.update).not.toHaveBeenCalled();

    await service.claimConfiguration(storeWith(repo), {
      sections: ['branding'], scopeKey: 'tenant-a', sourceRef: 'config_bundle:shared-key',
      ownershipMode: 'config_locked', sourceHash: 'new', appliedAt: 20, expectedGeneration: 3,
    });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'default:branding', generation: 3 },
      expect.objectContaining({ generation: 4, driftStatus: 'in_sync', scopeKey: 'tenant-a' }),
    );

    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.claimConfiguration(storeWith(repo), {
      sections: ['branding'], scopeKey: 'tenant-a', sourceRef: 'config_bundle:shared-key',
      ownershipMode: 'config_locked', sourceHash: 'new', appliedAt: 20, expectedGeneration: 3,
    })).rejects.toThrow('changed after preview');
  });

  it('uses the dedicated ownership repository', async () => {
    const repo = { find: vi.fn().mockResolvedValue([]) };
    const store = storeWith(repo);
    await service.list(store);
    expect(store.getRepository).toHaveBeenCalledWith(PlatformSettingsSectionOwnership);
  });
});
