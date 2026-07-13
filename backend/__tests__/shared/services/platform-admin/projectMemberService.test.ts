import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ProjectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/db/entities/RbacRoleAssignment.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

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

  it('writes direct canonical legacy assignments when project member roles change', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
    const memberRepo = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
    const roleRepo = {
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        orIgnore: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({}),
      }),
    };
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: 'tenant-1' }) };
    const assignmentRepo = {
      delete: vi.fn().mockResolvedValue({ affected: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return memberRepo;
        if (entity === ProjectMemberRole) return roleRepo;
        if (entity === Project) return projectRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    await service.updateRoles('project-1', 'user-1', ['developer', 'editor']);

    expect(assignmentRepo.delete).toHaveBeenCalledWith({
      id: expect.anything(),
    });
    expect(assignmentRepo.upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        id: 'legacy:project:project-1:user-1:system.project.developer',
        tenantId: 'tenant-1',
        source: 'legacy',
        sourceRef: 'project_member_role:project-1:user-1:developer',
        scopeType: 'project',
        scopeId: 'project-1',
      }),
      expect.objectContaining({
        id: 'legacy:project:project-1:user-1:system.project.editor',
        sourceRef: 'project_member_role:project-1:user-1:editor',
      }),
    ]), expect.objectContaining({ conflictPaths: ['id'] }));
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('removes direct canonical legacy assignments when a member is removed', async () => {
    const legacySyncSpy = vi.spyOn(permissionService, 'syncLegacyRoleAssignments');
    const memberRepo = { delete: vi.fn().mockResolvedValue({ affected: 1 }) };
    const roleRepo = { delete: vi.fn().mockResolvedValue({ affected: 2 }) };
    const assignmentRepo = { delete: vi.fn().mockResolvedValue({ affected: 2 }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return memberRepo;
        if (entity === ProjectMemberRole) return roleRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    await service.removeMember('project-1', 'user-1');

    expect(assignmentRepo.delete).toHaveBeenCalledWith({ id: expect.anything() });
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });
});
