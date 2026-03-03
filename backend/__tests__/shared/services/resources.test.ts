import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ResourceService } from '@enterpriseglue/shared/services/resources.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('ResourceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks if resource exists', async () => {
    const projectRepo = { count: vi.fn().mockResolvedValue(1) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const exists = await ResourceService.projectExists('project-1');
    expect(exists).toBe(true);
  });

  it('returns false when resource does not exist', async () => {
    const projectRepo = { count: vi.fn().mockResolvedValue(0) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const exists = await ResourceService.projectExists('nonexistent');
    expect(exists).toBe(false);
  });

  it('gets resource or throws', async () => {
    const userRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const user = await ResourceService.getUserOrThrow('user-1');
    expect(user.id).toBe('user-1');
  });

  it('throws when resource not found', async () => {
    const userRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(ResourceService.getUserOrThrow('nonexistent')).rejects.toThrow('User not found');
  });

  it('gets resource or returns null', async () => {
    const projectRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const project = await ResourceService.getProjectOrNull('nonexistent');
    expect(project).toBeNull();
  });

  it('gets file project ID', async () => {
    const fileRepo = { findOne: vi.fn().mockResolvedValue({ projectId: 'project-1' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return fileRepo;
        throw new Error('Unexpected repository');
      },
    });

    const projectId = await ResourceService.getFileProjectId('file-1');
    expect(projectId).toBe('project-1');
  });
});
