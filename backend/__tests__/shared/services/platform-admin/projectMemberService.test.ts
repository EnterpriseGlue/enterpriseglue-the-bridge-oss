import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ProjectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('ProjectMemberService', () => {
  const service = new ProjectMemberService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty list when no members', async () => {
    const memberRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return memberRepo;
        if (entity === User) return { find: vi.fn() };
        if (entity === ProjectMemberRole) return { find: vi.fn() };
        throw new Error('Unexpected repository');
      },
    });

    const members = await service.getMembers('project-1');
    expect(members).toEqual([]);
  });

  it('returns membership roles from roles table', async () => {
    const memberRepo = { findOne: vi.fn().mockResolvedValue({ role: 'viewer', userId: 'user-1' }) };
    const roleRepo = { find: vi.fn().mockResolvedValue([{ role: 'developer' }, { role: 'editor' }]) };
    const projectRepo = { findOne: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return memberRepo;
        if (entity === ProjectMemberRole) return roleRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const membership = await service.getMembership('project-1', 'user-1');
    expect(membership?.role).toBe('developer');
    expect(membership?.roles).toContain('editor');
  });

  it('falls back to owner role when user owns project', async () => {
    const memberRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const roleRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return memberRepo;
        if (entity === ProjectMemberRole) return roleRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const membership = await service.getMembership('project-1', 'owner-1');
    expect(membership?.role).toBe('owner');
  });
});
