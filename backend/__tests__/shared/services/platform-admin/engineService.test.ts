import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EngineService } from '../../../../src/shared/services/platform-admin/EngineService.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { Engine } from '../../../../src/shared/db/entities/Engine.js';
import { EngineMember } from '../../../../src/shared/db/entities/EngineMember.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('EngineService', () => {
  const service = new EngineService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns owner role when user is owner', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'user-1', delegateId: null }),
    };
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const role = await service.getEngineRole('user-1', 'engine-1');
    expect(role).toBe('owner');
  });

  it('returns membership role when user is member', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null }),
    };
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue({ role: 'operator' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const role = await service.getEngineRole('user-1', 'engine-1');
    expect(role).toBe('operator');
  });

  it('checks access for required roles', async () => {
    const engineRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null }),
    };
    const memberRepo = {
      findOne: vi.fn().mockResolvedValue({ role: 'deployer' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const allowed = await service.hasEngineAccess('user-1', 'engine-1', ['deployer', 'owner']);
    const denied = await service.hasEngineAccess('user-1', 'engine-1', ['owner']);
    expect(allowed).toBe(true);
    expect(denied).toBe(false);
  });
});
