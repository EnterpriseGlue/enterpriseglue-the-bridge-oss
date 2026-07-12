import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  DEFAULT_PLATFORM_GROUPS,
  DEFAULT_PLATFORM_GROUP_IDS,
  authzGroupService,
} from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { SYSTEM_ROLE_IDS } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  AuditLog,
  AuthzGroup,
  AuthzGroupMembership,
  RbacRoleAssignment,
  User,
} from '@enterpriseglue/shared/db/entities/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

function chainableQueryBuilder(result: unknown = null) {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(result),
  };
}

describe('authzGroupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds deterministic default platform groups and bootstrap role assignments', async () => {
    const groupRepo = {
      upsert: vi.fn(),
    };
    const roleAssignmentRepo = {
      upsert: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return groupRepo;
        if (entity === RbacRoleAssignment) return roleAssignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await authzGroupService.seedDefaultPlatformGroups(undefined, 12345);

    expect(result).toEqual({
      groups: DEFAULT_PLATFORM_GROUPS.length,
      assignments: DEFAULT_PLATFORM_GROUPS.length,
    });
    expect(groupRepo.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
          key: 'platform-administrators',
          name: 'Platform Administrators',
          source: 'system',
          isSystem: true,
          createdAt: 12345,
          updatedAt: 12345,
        }),
        expect.objectContaining({
          id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
          key: 'authenticated-users',
          name: 'Authenticated Users',
        }),
      ]),
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true }
    );
    const groupRows = groupRepo.upsert.mock.calls[0][0];
    expect(groupRows).toHaveLength(8);
    expect(groupRows.every((row: any) => row.tenantId === null && row.isArchived === false)).toBe(true);

    expect(roleAssignmentRepo.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: null,
          userId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
          principalType: 'group',
          principalId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
          roleId: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
          resourceType: 'platform',
          resourceId: null,
          scopeType: 'platform',
          scopeId: null,
          source: 'bootstrap',
          sourceRef: 'default-platform-groups',
          createdAt: 12345,
          updatedAt: 12345,
        }),
        expect.objectContaining({
          principalId: DEFAULT_PLATFORM_GROUP_IDS.ACCESS_ADMINISTRATORS,
          roleId: SYSTEM_ROLE_IDS.PLATFORM_ACCESS_ADMIN,
        }),
        expect.objectContaining({
          principalId: DEFAULT_PLATFORM_GROUP_IDS.API_CLIENT_ADMINISTRATORS,
          roleId: SYSTEM_ROLE_IDS.PLATFORM_API_CLIENT_ADMIN,
        }),
      ]),
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true }
    );
    const assignmentRows = roleAssignmentRepo.upsert.mock.calls[0][0];
    expect(assignmentRows).toHaveLength(8);
    expect(assignmentRows.every((row: any) => row.expiresAt === null && row.sourceMappingId === null)).toBe(true);
  });

  it('records group and membership mutation audit events', async () => {
    const groupRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(chainableQueryBuilder()),
      insert: vi.fn(),
      update: vi.fn(),
      findOneBy: vi.fn().mockResolvedValue({
        id: 'group-1',
        tenantId: 'tenant-a',
        key: 'operators',
        name: 'Operators',
        description: null,
        source: 'manual',
        sourceRef: null,
        isSystem: false,
        isArchived: false,
      }),
    };
    const membershipRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(chainableQueryBuilder()),
      insert: vi.fn(),
      delete: vi.fn(),
      findOneBy: vi.fn().mockResolvedValue({
        id: 'membership-1',
        tenantId: 'tenant-a',
        groupId: 'group-1',
        userId: 'user-1',
        source: 'manual',
        sourceRef: null,
      }),
    };
    const userRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const auditRepo = {
      insert: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return groupRepo;
        if (entity === AuthzGroupMembership) return membershipRepo;
        if (entity === User) return userRepo;
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    const group = await authzGroupService.createGroup({
      tenantId: 'tenant-a',
      key: 'operators',
      name: 'Operators',
      createdById: 'admin-1',
    });
    await authzGroupService.updateGroup('group-1', {
      tenantId: 'tenant-a',
      name: 'Engine operators',
      updatedById: 'admin-2',
    });
    await authzGroupService.updateGroup('group-1', {
      tenantId: 'tenant-a',
      isArchived: true,
      updatedById: 'admin-3',
    });
    const membership = await authzGroupService.addMembership({
      tenantId: 'tenant-a',
      groupId: 'group-1',
      userId: 'user-1',
      createdById: 'admin-4',
    });
    await authzGroupService.removeMembership('membership-1', 'admin-5');

    expect(group.id).toBeTruthy();
    expect(membership.id).toBeTruthy();
    expect(auditRepo.insert.mock.calls.map(([entry]) => entry.action)).toEqual([
      'authz.group.create',
      'authz.group.update',
      'authz.group.archive',
      'authz.group_membership.create',
      'authz.group_membership.delete',
    ]);
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      action: 'authz.group.create',
      resourceType: 'authz_group',
      details: expect.stringContaining('operators'),
    }));
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-4',
      action: 'authz.group_membership.create',
      resourceType: 'authz_group_membership',
      details: expect.stringContaining('user-1'),
    }));
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-5',
      action: 'authz.group_membership.delete',
      resourceType: 'authz_group_membership',
      resourceId: 'membership-1',
    }));
  });
});
