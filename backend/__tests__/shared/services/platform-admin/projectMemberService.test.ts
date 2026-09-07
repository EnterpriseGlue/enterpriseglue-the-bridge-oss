import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ProjectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/db/entities/RbacRoleAssignment.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import type { EntityManager } from 'typeorm';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('ProjectMemberService', () => {
  const service = new ProjectMemberService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['missing', 'inactive'] as const)('opens a transaction for tenant-scoped enrollment with a %s manager', async (kind) => {
    const claim = vi.fn().mockResolvedValue({ affected: 1 });
    const findMember = vi.fn().mockResolvedValue({ id: 'member-a' });
    const manager = { queryRunner: { isTransactionActive: true }, getRepository: (entity: unknown) => {
      if (entity === Project) return { update: claim };
      if (entity === ProjectMember) return { findOne: findMember };
      if (entity === ProjectMemberRole) return {};
      throw new Error('Unexpected repository');
    } } as unknown as EntityManager;
    const transaction = vi.fn(async (work: (store: EntityManager) => unknown) => work(manager));
    const inactive = { transaction, getRepository: () => { throw new Error('Write outside transaction'); } } as unknown as EntityManager;
    vi.mocked(getDataSource).mockResolvedValue(inactive as any);
    const scopedService = new ProjectMemberService();
    const update = vi.spyOn(scopedService, 'updateRoles').mockResolvedValue();
    await expect(scopedService.addMember('project-a', 'user-a', ['viewer'], 'inviter-a', kind === 'inactive' ? inactive : undefined, 'alpha')).resolves.toMatchObject({ id: 'member-a' });
    expect(transaction).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledWith({ id: 'project-a', tenantId: 'alpha' }, { tenantId: 'alpha' });
    expect(update).toHaveBeenCalledWith('project-a', 'user-a', ['viewer'], manager);
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(findMember.mock.invocationCallOrder[0]);
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

  it('does not treat project ownership metadata as an authorization membership', async () => {
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
    expect(membership).toBeNull();
  });

  it('uses canonical owner assignments for ownership transfer discovery', async () => {
    const assignmentRepo = {
      find: vi.fn().mockResolvedValue([{ principalId: 'canonical-owner-1' }]),
    };
    const projectRepo = { findOne: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(service.getProjectOwners('project-1')).resolves.toEqual(['canonical-owner-1']);
    expect(assignmentRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        principalType: 'user',
        roleId: 'system.project.owner',
        scopeType: 'project',
        scopeId: 'project-1',
      }),
    }));
    expect(projectRepo.findOne).not.toHaveBeenCalled();
  });

  it('writes direct canonical manual assignments when project member roles change', async () => {
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
        id: 'manual:project:project-1:user-1:system.project.developer',
        tenantId: 'tenant-1',
        source: 'manual',
        sourceRef: 'project_membership:project-1:user-1:developer',
        scopeType: 'project',
        scopeId: 'project-1',
      }),
      expect.objectContaining({
        id: 'manual:project:project-1:user-1:system.project.editor',
        sourceRef: 'project_membership:project-1:user-1:editor',
      }),
    ]), expect.objectContaining({ conflictPaths: ['id'] }));
    expect(legacySyncSpy).not.toHaveBeenCalled();
  });

  it('removes current and compatibility canonical assignments when a member is removed', async () => {
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
