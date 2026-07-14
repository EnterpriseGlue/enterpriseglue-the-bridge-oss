import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  DEFAULT_PLATFORM_GROUPS,
  DEFAULT_PLATFORM_GROUP_IDS,
  authzGroupKeyIdentity,
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
          groupKeyIdentity: 'platform:platform-administrators',
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
          principalType: 'group',
          principalId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
          roleId: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
          scopeType: 'platform',
          scopeId: null,
          source: 'bootstrap',
          sourceRef: 'default-platform-groups',
          assignmentKey: expect.any(String),
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
    expect(assignmentRows.every((row: any) => row.expiresAt === null)).toBe(true);
    expect(assignmentRows.every((row: any) => !Object.prototype.hasOwnProperty.call(row, 'userId') && !Object.prototype.hasOwnProperty.call(row, 'resourceType') && !Object.prototype.hasOwnProperty.call(row, 'resourceId') && !Object.prototype.hasOwnProperty.call(row, 'sourceMappingId'))).toBe(true);
  });

  it('records group and membership mutation audit events', async () => {
    const groupRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(chainableQueryBuilder()),
      insert: vi.fn(),
      update: vi.fn(),
      findOneBy: vi.fn().mockImplementation((where: Record<string, unknown>) => Promise.resolve(
        'groupKeyIdentity' in where
          ? null
          : {
            id: 'group-1',
            tenantId: 'tenant-a',
            key: 'operators',
            name: 'Operators',
            description: null,
            source: 'manual',
            sourceRef: null,
            isSystem: false,
            isArchived: false,
          }
      )),
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
    expect(groupRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      key: 'operators',
      groupKeyIdentity: 'tenant-a:operators',
    }));
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

  it('uses a non-null canonical identity for global and tenant-scoped group keys', () => {
    expect(authzGroupKeyIdentity(null, 'operators')).toBe('platform:operators');
    expect(authzGroupKeyIdentity('tenant-a', 'operators')).toBe('tenant-a:operators');
  });

  it('creates the authenticated-user baseline once through the provisioning transaction manager', async () => {
    const groupRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
        tenantId: null,
        source: 'system',
        isArchived: false,
      }),
    };
    const membershipRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      insert: vi.fn(),
    };
    const auditRepo = { insert: vi.fn() };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return groupRepo;
        if (entity === AuthzGroupMembership) return membershipRepo;
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    };

    const result = await authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager as any, 'user-1');

    expect(result).toEqual({ id: expect.any(String), created: true });
    expect(membershipRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: null,
      groupId: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
      userId: 'user-1',
      source: 'system',
      sourceRef: 'authenticated-user-baseline',
    }));
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'authz.group_membership.authenticate',
    }));

    membershipRepo.findOneBy.mockResolvedValueOnce({ id: 'baseline-membership-1' });
    await expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager(manager as any, 'user-1'))
      .resolves.toEqual({ id: 'baseline-membership-1', created: false });
    expect(membershipRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('backfills only active users missing the authenticated-user baseline', async () => {
    const groupRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
        tenantId: null,
        source: 'system',
        isArchived: false,
      }),
    };
    const userRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]),
    };
    const membershipRepo = {
      find: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
      insert: vi.fn(),
    };
    const auditRepo = { insert: vi.fn() };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return groupRepo;
        if (entity === User) return userRepo;
        if (entity === AuthzGroupMembership) return membershipRepo;
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    };
    const dataSource = {
      transaction: vi.fn(async (callback: (transactionManager: typeof manager) => unknown) => callback(manager)),
    };

    await expect(authzGroupService.backfillAuthenticatedUserMemberships(dataSource as any, 12345))
      .resolves.toEqual({ scanned: 2, created: 1 });
    expect(membershipRepo.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        groupId: DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS,
        userId: 'user-2',
        source: 'system',
        sourceRef: 'authenticated-user-baseline',
        createdAt: 12345,
      }),
    ]);
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'authz.group_membership.backfill',
      details: expect.stringContaining('"created":1'),
    }));
  });

  it('removes only the legacy-derived platform-administrator membership on demotion', async () => {
    const membershipRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'legacy-admin-membership-1' }),
      delete: vi.fn(),
    };
    const auditRepo = { insert: vi.fn() };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return membershipRepo;
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    };

    await expect(authzGroupService.removeLegacyPlatformAdministratorMembershipWithManager(manager as any, 'user-1'))
      .resolves.toEqual({ removed: true });
    expect(membershipRepo.findOneBy).toHaveBeenCalledWith({
      groupId: DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS,
      userId: 'user-1',
      source: 'system',
      sourceRef: 'legacy-platform-role-administrator',
    });
    expect(membershipRepo.delete).toHaveBeenCalledWith({ id: 'legacy-admin-membership-1' });
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'authz.group_membership.legacy_platform_admin_remove',
    }));
  });

  it('rejects manual mutations for config-managed groups and memberships', async () => {
    const groupRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'group-config',
        tenantId: 'tenant-a',
        key: 'group.config',
        name: 'Config group',
        description: null,
        source: 'config',
        sourceRef: 'config_bundle:acme.authz',
        isSystem: false,
        isArchived: false,
      }),
      update: vi.fn(),
    };
    const membershipRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'membership-config',
        tenantId: 'tenant-a',
        groupId: 'group-config',
        userId: 'user-1',
        source: 'config',
        sourceRef: 'config_bundle:acme.authz',
      }),
      delete: vi.fn(),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return groupRepo;
        if (entity === AuthzGroupMembership) return membershipRepo;
        if (entity === AuditLog) return { insert: vi.fn() };
        throw new Error('Unexpected repository');
      },
    });

    await expect(authzGroupService.updateGroup('group-config', { name: 'Changed' }))
      .rejects.toThrow('Source-managed groups must be updated by their source');
    await expect(authzGroupService.addMembership({ groupId: 'group-config', userId: 'user-1' }))
      .rejects.toThrow('Source-managed group memberships must be updated by their source');
    await expect(authzGroupService.removeMembership('membership-config'))
      .rejects.toThrow('Source-managed group memberships must be updated by their source');
    expect(groupRepo.update).not.toHaveBeenCalled();
    expect(membershipRepo.delete).not.toHaveBeenCalled();
  });

  it('allows a config-warning group edit and marks its state as drifted', async () => {
    const groupRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'group-config-warning', tenantId: 'tenant-a', key: 'group.warning', name: 'Warning group', description: null,
        source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn', driftStatus: 'in_sync',
        isSystem: false, isArchived: false,
      }),
      update: vi.fn(),
    };
    const auditRepo = { insert: vi.fn() };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroup) return groupRepo;
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    await authzGroupService.updateGroup('group-config-warning', {
      tenantId: 'tenant-a', name: 'Locally changed', updatedById: 'admin-1',
    });

    expect(groupRepo.update).toHaveBeenCalledWith({ id: 'group-config-warning' }, expect.objectContaining({
      name: 'Locally changed', driftStatus: 'drifted',
    }));
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ details: expect.stringContaining('drifted') }));
  });
});
