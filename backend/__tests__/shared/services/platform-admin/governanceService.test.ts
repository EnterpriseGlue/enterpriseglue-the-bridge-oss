import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import { governanceService } from '@enterpriseglue/shared/services/platform-admin/GovernanceService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('GovernanceService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('delegates engine delegate changes to the canonical engine command', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', name: 'Engine One', delegateId: 'previous-user' }),
    };
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'next-user' }),
    };
    const assignDelegateSpy = vi.spyOn(engineService, 'assignDelegate').mockResolvedValue();
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await governanceService.assignEngineDelegate('engine-1', 'next-user');

    expect(assignDelegateSpy).toHaveBeenCalledWith('engine-1', 'next-user');
    expect(legacySyncSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ previousDelegateId: 'previous-user', engineName: 'Engine One' });
  });
});
