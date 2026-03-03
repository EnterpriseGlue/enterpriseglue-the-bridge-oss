import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EngineAccessService } from '@enterpriseglue/shared/services/platform-admin/EngineAccessService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/db/entities/EngineProjectAccess.js';
import { EngineAccessRequest } from '@enterpriseglue/shared/db/entities/EngineAccessRequest.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('EngineAccessService', () => {
  const service = new EngineAccessService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns approved when access already exists', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue({ id: 'access-1' }) };
    const requestRepo = { findOne: vi.fn() };
    const engineRepo = { findOne: vi.fn() };
    const memberRepo = { find: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === ProjectMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('approved');
  });

  it('returns pending when request already exists', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const requestRepo = { findOne: vi.fn().mockResolvedValue({ id: 'req-1' }) };
    const engineRepo = { findOne: vi.fn() };
    const memberRepo = { find: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === ProjectMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('pending');
    expect(result.requestId).toBe('req-1');
  });

  it('auto-approves when project leader matches engine owner', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const requestRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ ownerId: 'user-1', delegateId: null }) };
    const memberRepo = { find: vi.fn().mockResolvedValue([{ userId: 'user-1' }]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === ProjectMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('approved');
    expect(accessRepo.insert).toHaveBeenCalled();
  });

  it('creates pending request when no auto-approval', async () => {
    const accessRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const requestRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn() };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ ownerId: 'owner-1', delegateId: null }) };
    const memberRepo = { find: vi.fn().mockResolvedValue([{ userId: 'member-1' }]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EngineProjectAccess) return accessRepo;
        if (entity === EngineAccessRequest) return requestRepo;
        if (entity === Engine) return engineRepo;
        if (entity === ProjectMember) return memberRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await service.requestAccess('project-1', 'engine-1', 'user-1');
    expect(result.status).toBe('pending');
    expect(requestRepo.insert).toHaveBeenCalled();
  });
});
