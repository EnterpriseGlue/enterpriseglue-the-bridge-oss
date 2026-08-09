import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/db/entities/ProjectMemberRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { projectCreationService } from '@enterpriseglue/shared/services/starbase/ProjectCreationService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

function insertBuilder(execute = vi.fn().mockResolvedValue({})) {
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute,
  };
}

describe('ProjectCreationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the project, compatibility memberships, and canonical owner assignment in one transaction', async () => {
    const projectInsert = vi.fn().mockResolvedValue({});
    const memberBuilder = insertBuilder();
    const roleBuilder = insertBuilder();
    const assignmentUpsert = vi.fn().mockResolvedValue({});
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Project) return { insert: projectInsert };
        if (entity === ProjectMember) return { createQueryBuilder: () => memberBuilder };
        if (entity === ProjectMemberRole) return { createQueryBuilder: () => roleBuilder };
        if (entity === RbacRoleAssignment) return { upsert: assignmentUpsert };
        throw new Error('Unexpected repository');
      },
    };
    const transaction = vi.fn(async (callback) => callback(manager));
    vi.mocked(getDataSource).mockResolvedValue({ transaction } as any);

    const result = await projectCreationService.createWithOwner({
      name: 'Payments', ownerId: 'user-1', tenantId: 'tenant-a',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(projectInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: result.projectId, name: 'Payments', ownerId: 'user-1', tenantId: 'tenant-a',
    }));
    expect(memberBuilder.execute).toHaveBeenCalledTimes(1);
    expect(roleBuilder.execute).toHaveBeenCalledTimes(1);
    expect(assignmentUpsert).toHaveBeenCalledWith([
      expect.objectContaining({
        tenantId: 'tenant-a', principalId: 'user-1', scopeType: 'project', scopeId: result.projectId,
      }),
    ], expect.objectContaining({ conflictPaths: ['id'] }));
  });

  it('does not perform any project write outside the transaction boundary', async () => {
    const transaction = vi.fn().mockRejectedValue(new Error('owner assignment failed'));
    const getRepository = vi.fn(() => { throw new Error('outside-transaction repository use'); });
    vi.mocked(getDataSource).mockResolvedValue({ transaction, getRepository } as any);

    await expect(projectCreationService.createWithOwner({
      name: 'Payments', ownerId: 'user-1', tenantId: 'tenant-a',
    })).rejects.toThrow('owner assignment failed');

    expect(getRepository).not.toHaveBeenCalled();
  });
});
