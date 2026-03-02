import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AuthorizationService } from '@enterpriseglue/shared/services/authorization.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('AuthorizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies project ownership', async () => {
    const projectRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'p1', ownerId: 'user-1' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await AuthorizationService.verifyProjectOwnership('p1', 'user-1');
    expect(result).toBe(true);
  });

  it('denies non-owner project access', async () => {
    const projectRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await AuthorizationService.verifyProjectOwnership('p1', 'user-2');
    expect(result).toBe(false);
  });

  it('grants project access to member', async () => {
    const memberRepo = { findOneBy: vi.fn().mockResolvedValue({ userId: 'user-1' }) };
    const projectRepo = { findOneBy: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return memberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await AuthorizationService.verifyProjectAccess('p1', 'user-1');
    expect(result).toBe(true);
  });

  it('verifies file ownership via project', async () => {
    const fileRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'f1', projectId: 'p1' }) };
    const projectRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'p1', ownerId: 'user-1' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return fileRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await AuthorizationService.verifyFileOwnership('f1', 'user-1');
    expect(result).toBe(true);
  });
});
