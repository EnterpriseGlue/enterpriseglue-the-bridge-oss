import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  EnginePermissions,
  EngineRolePermissions,
  ExternalEngineSystemPermissions,
  PermissionCatalog,
  PlatformPermissions,
  ProjectRolePermissions,
  ProjectPermissions,
  SYSTEM_ROLE_IDS,
  permissionService,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { listAuthzActions } from '@enterpriseglue/shared/authz/permission-actions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  AuditLog,
  ApiClient,
  AuthzGroup,
  AuthzGroupMembership,
  Engine,
  EngineSet,
  EngineSetMaterialization,
  EngineMember,
  ExternalEngineRegistration,
  ExternalEngineSystem,
  PermissionGrant,
  Project,
  ProjectMember,
  ProjectMemberRole,
  RbacPermission,
  RbacRole,
  RbacRoleAssignment,
  RbacRolePermission,
  RuntimeResource,
  ServiceAccount,
  SsoAssignmentMapping,
  SsoGroupMapping,
  User,
} from '@enterpriseglue/shared/db/entities/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

function createGroupMembershipRepo(groupIds: string[] = []) {
  const qb = {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(groupIds.map((groupId) => ({ groupId }))),
  };
  return {
    repo: {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      find: vi.fn().mockResolvedValue(groupIds.map((groupId) => ({
        id: `membership-${groupId}`,
        groupId,
        userId: 'user-1',
        source: 'manual',
        sourceRef: null,
        expiresAt: null,
      }))),
    },
    qb,
  };
}

describe('permissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grants admin role all permissions', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: vi.fn() });

    const result = await permissionService.hasPermission(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
      platformRole: 'admin',
    });
    expect(result).toBe(true);
  });

  it('checks explicit grants when roles do not match', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({ id: 'grant-1' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const grantRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(grantQb),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return grantRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.hasPermission(PlatformPermissions.USER_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
    });

    expect(result).toBe(true);
    expect(grantRepo.createQueryBuilder).toHaveBeenCalledWith('g');
    expect(assignmentRepo.createQueryBuilder).toHaveBeenCalledWith('assignment');
  });

  it('keeps platform:user:manage explicit grants compatible with granular user actions', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-legacy-manage' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', ownerId: 'owner-1', tenantId: null }) };
        if (entity === ProjectMember) return { findOne: vi.fn().mockResolvedValue(null) };
        if (entity === ProjectMemberRole) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(PlatformPermissions.USERS_UPDATE, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('grant:explicit');
    expect(result.sources).toEqual([{ type: 'explicit-grant', permission: PlatformPermissions.USER_MANAGE }]);
  });

  it('keeps platform manage grants compatible with migrated platform read actions', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-authz-manage' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-sets-manage' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-project-engine-targets-manage' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-sso-assignments-manage' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.hasPermission(PlatformPermissions.AUTHZ_ROLES_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.ENGINE_SETS_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.SSO_ASSIGNMENTS_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    })).resolves.toBe(true);
  });

  it('keeps coarse settings and engine-registration grants compatible with split SSO and machine-identity admin actions', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-settings-manage' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-registration-manage' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-registration-manage' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.hasPermission(PlatformPermissions.SSO_PROVIDERS_MANAGE, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.API_CLIENTS_MANAGE, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.SERVICE_ACCOUNTS_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'platform',
    })).resolves.toBe(true);
  });

  it('keeps project:members:manage explicit grants compatible with granular member actions', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-project-members-manage' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', ownerId: 'owner-1', tenantId: null }) };
        if (entity === ProjectMember) return { findOne: vi.fn().mockResolvedValue(null) };
        if (entity === ProjectMemberRole) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(ProjectPermissions.MEMBERS_UPDATE_ROLE, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'project',
      resourceId: 'project-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('grant:explicit');
    expect(result.sources).toEqual([{ type: 'explicit-grant', permission: ProjectPermissions.MEMBERS_MANAGE }]);
  });

  it('includes project-scoped deployment target management in owner and delegate system role permissions', () => {
    expect(ProjectRolePermissions.owner).toEqual(expect.arrayContaining([
      ProjectPermissions.DEPLOYMENT_TARGETS_VIEW,
      ProjectPermissions.DEPLOYMENT_TARGETS_MANAGE,
    ]));
    expect(ProjectRolePermissions.delegate).toEqual(expect.arrayContaining([
      ProjectPermissions.DEPLOYMENT_TARGETS_VIEW,
      ProjectPermissions.DEPLOYMENT_TARGETS_MANAGE,
    ]));
    expect(ProjectRolePermissions.developer).not.toContain(ProjectPermissions.DEPLOYMENT_TARGETS_MANAGE);
    expect(ProjectRolePermissions.viewer).not.toContain(ProjectPermissions.DEPLOYMENT_TARGETS_VIEW);
  });

  it('keeps engine:members:manage explicit grants compatible with granular member actions', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-members-manage' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null, tenantId: null }) };
        if (entity === EngineMember) return { findOne: vi.fn().mockResolvedValue(null) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.MEMBERS_UPDATE_ROLE, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('grant:explicit');
    expect(result.sources).toEqual([{ type: 'explicit-grant', permission: EnginePermissions.MEMBERS_MANAGE }]);
  });

  it('keeps engine:secrets:manage explicit grants compatible with secret view', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-secrets-manage' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null, tenantId: null }) };
        if (entity === EngineMember) return { findOne: vi.fn().mockResolvedValue(null) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.SECRETS_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('grant:explicit');
    expect(result.sources).toEqual([{ type: 'explicit-grant', permission: EnginePermissions.SECRETS_MANAGE }]);
  });

  it('keeps engine:instance:view explicit grants compatible with engine member reads', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-instance-view' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null, tenantId: null }) };
        if (entity === EngineMember) return { findOne: vi.fn().mockResolvedValue(null) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.MEMBERS_VIEW, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('grant:explicit');
    expect(result.sources).toEqual([{ type: 'explicit-grant', permission: EnginePermissions.INSTANCE_VIEW }]);
  });

  it('includes explicit engine grants in known engine discovery', async () => {
    const grantQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ resourceId: 'engine-granted' }]),
    };
    const assignmentQb = {
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === EngineMember) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.getKnownEngineIdsForUser('user-1');

    expect(result).toEqual(['engine-granted']);
    expect(grantQb.where).toHaveBeenCalledWith('grant.userId = :userId', { userId: 'user-1' });
    expect(grantQb.andWhere).toHaveBeenCalledWith('grant.resourceType = :resourceType', { resourceType: 'engine' });
  });

  it('keeps engine:members:manage explicit grants compatible with engine project-access actions', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-project-access-manage' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null, tenantId: null }) };
        if (entity === EngineMember) return { findOne: vi.fn().mockResolvedValue(null) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.PROJECT_ACCESS_APPROVE, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('grant:explicit');
    expect(result.sources).toEqual([{ type: 'explicit-grant', permission: EnginePermissions.MEMBERS_MANAGE }]);
  });

  it('keeps engine:edit explicit grants compatible with granular environment actions', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'grant-engine-edit' }),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'owner-1', delegateId: null, tenantId: null }) };
        if (entity === EngineMember) return { findOne: vi.fn().mockResolvedValue(null) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.ENVIRONMENT_SET, {
      userId: 'user-1',
      platformRole: 'user',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('grant:explicit');
    expect(result.sources).toEqual([{ type: 'explicit-grant', permission: EnginePermissions.ENGINE_EDIT }]);
  });

  it('grants permissions from scoped role assignments', async () => {
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'assignment-manual-engine-deployer',
        roleId: 'custom-engine-role',
        source: 'manual',
        sourceMappingId: null,
      }]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([{ id: 'group-operators', key: 'operators', name: 'Operators', isArchived: false }]) };
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
      platformRole: 'user',
      engineRole: 'none',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('role-assignment:custom-engine-role');
    expect(result.sources[0]).toMatchObject({
      type: 'role-assignment',
      assignmentId: 'assignment-manual-engine-deployer',
      source: 'manual',
    });
  });

  it('grants permissions inherited from group role assignments', async () => {
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'assignment-group-engine-deployer',
        roleId: 'group-engine-role',
        principalType: 'group',
        principalId: 'group-operators',
        source: 'manual',
        sourceMappingId: null,
        sourceRef: null,
      }]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    const groupMembership = createGroupMembershipRepo(['group-operators']);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([{ id: 'group-operators', key: 'operators', name: 'Operators', isArchived: false }]) };
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
      platformRole: 'user',
      engineRole: 'none',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.sources[0]).toMatchObject({
      type: 'role-assignment',
      assignmentId: 'assignment-group-engine-deployer',
      principalType: 'group',
      principalId: 'group-operators',
    });
    expect(assignmentQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('groupPrincipalType'),
      expect.objectContaining({ groupIds: ['group-operators'] }),
    );
  });

  it('explains SSO group membership lineage for inherited group role assignments', async () => {
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'assignment-sso-group-engine-deployer',
        roleId: 'group-engine-role',
        principalType: 'group',
        principalId: 'group-operators',
        source: 'manual',
        sourceMappingId: null,
        sourceRef: null,
      }]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    const groupMembership = createGroupMembershipRepo(['group-operators']);
    groupMembership.repo.find.mockResolvedValue([{
      id: 'membership-sso-operators',
      groupId: 'group-operators',
      userId: 'user-1',
      source: 'sso',
      sourceRef: 'sso-group-mapping-operators',
      expiresAt: null,
    }]);
    const authzGroupRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'group-operators', key: 'operators', name: 'Operators', isArchived: false }]),
    };
    const ssoGroupMappingRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'sso-group-mapping-operators',
        providerId: null,
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Operators',
        claimOperator: 'contains',
        targetGroupId: 'group-operators',
        syncMode: 'authoritative',
      }]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === AuthzGroup) return authzGroupRepo;
        if (entity === SsoGroupMapping) return ssoGroupMappingRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
      platformRole: 'user',
      engineRole: 'none',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.sources[0]).toMatchObject({
      type: 'role-assignment',
      assignmentId: 'assignment-sso-group-engine-deployer',
      principalType: 'group',
      principalId: 'group-operators',
      groupId: 'group-operators',
      groupKey: 'operators',
      groupName: 'Operators',
      groupMembership: {
        id: 'membership-sso-operators',
        source: 'sso',
        sourceRef: 'sso-group-mapping-operators',
        expiresAt: null,
      },
      ssoGroupMapping: {
        id: 'sso-group-mapping-operators',
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Operators',
        claimOperator: 'contains',
        targetGroupId: 'group-operators',
        syncMode: 'authoritative',
      },
    });
  });

  it('explains SSO Engine Set role assignment lineage', async () => {
    const directAssignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const engineSetAssignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'assignment-sso-engine-set-operator',
        roleId: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
        principalType: 'user',
        principalId: 'user-1',
        userId: 'user-1',
        source: 'sso',
        sourceMappingId: 'mapping-prod-operators',
        sourceRef: 'mapping-prod-operators',
        scopeType: 'engine_set',
        scopeId: 'engine-set-prod',
      }]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn()
        .mockReturnValueOnce(directAssignmentQb)
        .mockReturnValueOnce(engineSetAssignmentQb),
    };
    const materializationRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'materialization-1',
        engineSetId: 'engine-set-prod',
        engineId: 'engine-1',
        selectorFingerprint: 'selector-fingerprint-1',
        matchedByJson: '{"mode":"labels","labels":{"environment":"prod"}}',
        lineageJson: '{"source":"sso","sourceRef":"mapping-prod-operators"}',
      }]),
    };
    const engineSetRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'engine-set-prod',
        key: 'sso-prod-operators',
        name: 'SSO Prod Operators',
        selectorFingerprint: 'selector-fingerprint-1',
        isArchived: false,
      }]),
    };
    const ssoMappingRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'mapping-prod-operators',
        providerId: null,
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Prod Operators',
        claimOperator: 'equals',
        targetSelectorType: 'engine_label',
      }]),
    };
    const engineRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'engine-1',
        name: 'Payments Prod',
        externalId: 'cluster-a/prod-engine',
        registrationSource: 'manual',
        externalSystemId: null,
        lifecycleStatus: 'active',
        lastExternalSyncAt: null,
        externalUpdatedAt: 1200,
      }]),
    };
    const externalRegistrationRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'registration-1',
        engineId: 'engine-1',
        externalId: 'cluster-a/prod',
        registrationSource: 'external_api',
        externalSystemId: 'system-1',
        lifecycleStatus: 'active',
        apiClientId: 'api-client-1',
        lastExternalSyncAt: 1300,
        lastRegisteredAt: 1250,
      }]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === Engine) return engineRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        if (entity === EngineSetMaterialization) return materializationRepo;
        if (entity === EngineSet) return engineSetRepo;
        if (entity === ExternalEngineRegistration) return externalRegistrationRepo;
        if (entity === SsoAssignmentMapping) return ssoMappingRepo;
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
      platformRole: 'user',
      engineRole: 'none',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe(`role-assignment:${SYSTEM_ROLE_IDS.ENGINE_OPERATOR}`);
    expect(result.sources[0]).toMatchObject({
      type: 'role-assignment',
      assignmentId: 'assignment-sso-engine-set-operator',
      roleId: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
      source: 'sso',
      sourceMappingId: 'mapping-prod-operators',
      scopeType: 'engine_set',
      scopeId: 'engine-set-prod',
      engineSetId: 'engine-set-prod',
      engineSetKey: 'sso-prod-operators',
      engineSetName: 'SSO Prod Operators',
      selectorFingerprint: 'selector-fingerprint-1',
      materializationId: 'materialization-1',
      matchedEngineId: 'engine-1',
      engineRegistration: {
        engineId: 'engine-1',
        engineName: 'Payments Prod',
        externalId: 'cluster-a/prod',
        registrationId: 'registration-1',
        registrationSource: 'external_api',
        externalSystemId: 'system-1',
        lifecycleStatus: 'active',
        apiClientId: 'api-client-1',
        lastExternalSyncAt: 1300,
        lastRegisteredAt: 1250,
        externalUpdatedAt: 1200,
      },
      ssoMapping: {
        id: 'mapping-prod-operators',
        claimType: 'group',
        claimKey: 'groups',
        claimValue: 'Prod Operators',
        claimOperator: 'equals',
        targetSelectorType: 'engine_label',
      },
    });
    expect(result.sources[0].matchedBy).toEqual({ mode: 'labels', labels: { environment: 'prod' } });
    expect(result.sources[0].lineage).toEqual({ source: 'sso', sourceRef: 'mapping-prod-operators' });
    expect(materializationRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ engineId: 'engine-1' }),
    }));
  });

  it('applies tenant scope when evaluating role assignments while keeping legacy null-tenant assignments eligible', async () => {
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ roleId: 'tenant-engine-role', source: 'manual', sourceMappingId: null }]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(assignmentQb),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
      tenantId: 'tenant-a',
      platformRole: 'user',
      engineRole: 'none',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(assignmentQb.andWhere).toHaveBeenCalledWith(
      '(assignment.tenantId IN (:...tenantIds) OR assignment.tenantId IS NULL)',
      { tenantIds: ['tenant-a'] },
    );
    expect(assignmentQb.andWhere).toHaveBeenCalledWith(
      '(role.tenantId IN (:...tenantIds) OR role.tenantId IS NULL)',
      { tenantIds: ['tenant-a'] },
    );
  });

  it('grants and revokes permissions', async () => {
    const insert = vi.fn();
    const execute = vi.fn();
    const deleteBuilder = {
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute,
    };

    const repo = {
      insert,
      createQueryBuilder: vi.fn().mockReturnValue(deleteBuilder),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PermissionGrant) return repo;
        throw new Error('Unexpected repository');
      },
    });

    const grant = await permissionService.grantPermission({
      userId: 'user-1',
      permission: PlatformPermissions.USER_VIEW,
      grantedById: 'admin-1',
    });

    expect(grant.id).toBeTruthy();
    expect(insert).toHaveBeenCalled();

    const revoked = await permissionService.revokePermission('user-1', PlatformPermissions.USER_VIEW);
    expect(revoked).toBe(true);
    expect(execute).toHaveBeenCalled();
  });

  it('exposes the seeded permission catalog', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacPermission) return { find: vi.fn().mockResolvedValue([]) };
        throw new Error('Unexpected repository');
      },
    });

    const catalog = await permissionService.getPermissionCatalog();

    expect(catalog.some((permission) => permission.key === PlatformPermissions.AUTHZ_CHECK)).toBe(true);
    expect(catalog.some((permission) => permission.key === PlatformPermissions.USERS_CREATE)).toBe(true);
    expect(catalog.some((permission) => permission.key === PlatformPermissions.USERS_UNLOCK)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.FILES_VIEW)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.MEMBERS_SEARCH)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.MEMBERS_INVITE)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.MEMBERS_ADD)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.MEMBERS_UPDATE_ROLE)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.MEMBERS_REMOVE)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.MEMBERS_MANAGE_DEPLOY_GRANT)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.DELEGATE_MANAGE)).toBe(true);
    expect(catalog.some((permission) => permission.key === ProjectPermissions.OWNERSHIP_TRANSFER)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.INSTANCE_VIEW)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.SECRETS_VIEW)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.SECRETS_MANAGE)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.MEMBERS_LOOKUP)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.MEMBERS_INVITE)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.MEMBERS_ADD)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.MEMBERS_UPDATE_ROLE)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.MEMBERS_REMOVE)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.ENVIRONMENT_SET)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.ENVIRONMENT_LOCK)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.PROJECT_ACCESS_VIEW)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.PROJECT_ACCESS_APPROVE)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.PROJECT_ACCESS_DENY)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.PROJECT_ACCESS_REVOKE)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.DELEGATE_MANAGE)).toBe(true);
    expect(catalog.some((permission) => permission.key === EnginePermissions.OWNERSHIP_TRANSFER)).toBe(true);
    expect(catalog.some((permission) =>
      permission.key === ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE &&
      permission.scope === 'external_engine_system'
    )).toBe(true);
    expect(catalog.some((permission) =>
      permission.key === ExternalEngineSystemPermissions.PROJECT_TARGETS_MANAGE &&
      permission.scope === 'external_engine_system'
    )).toBe(true);
  });

  it('keeps every action-registry permission in the seeded catalog', () => {
    const catalogKeys = new Set(PermissionCatalog.map((permission) => permission.key));
    const missing = Array.from(new Set(
      listAuthzActions()
        .map((action) => action.permissionId)
        .filter((permissionId) => !catalogKeys.has(permissionId))
    )).sort();

    expect(missing).toEqual([]);
  });

  it('creates custom permissions with audit records', async () => {
    const permissionInsert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === RbacPermission) return { insert: permissionInsert };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    };
    const permissionRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction: async (callback: any) => callback(manager),
      getRepository: (entity: unknown) => {
        if (entity === RbacPermission) return permissionRepo;
        throw new Error('Unexpected repository');
      },
    });

    const created = await permissionService.createCustomPermission({
      key: 'engine:custom:operate-special',
      scope: 'engine',
      category: 'Operations',
      label: 'Operate special',
      description: 'Allows a custom engine operation.',
      createdById: 'admin-1',
    });

    expect(created).toEqual({
      id: 'engine:custom:operate-special',
      key: 'engine:custom:operate-special',
    });
    expect(permissionInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'engine:custom:operate-special',
      key: 'engine:custom:operate-special',
      scope: 'engine',
      kind: 'custom',
      isEditable: true,
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      action: 'authz.permission.create',
      resourceType: 'permission',
      resourceId: 'engine:custom:operate-special',
    }));
  });

  it('allows custom roles to use persisted custom permissions', async () => {
    const roleInsert = vi.fn().mockResolvedValue(undefined);
    const permissionDelete = vi.fn().mockResolvedValue(undefined);
    const permissionInsert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { insert: roleInsert };
        if (entity === RbacRolePermission) return { delete: permissionDelete, insert: permissionInsert };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    };
    const permissionRepo = {
      find: vi.fn().mockResolvedValue([
        {
          id: 'engine:custom:operate-special',
          key: 'engine:custom:operate-special',
          scope: 'engine',
          category: 'Operations',
          label: 'Operate special',
          description: 'Allows a custom engine operation.',
          kind: 'custom',
          isEditable: true,
          isArchived: false,
          createdById: 'admin-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction: async (callback: any) => callback(manager),
      getRepository: (entity: unknown) => {
        if (entity === RbacPermission) return permissionRepo;
        throw new Error('Unexpected repository');
      },
    });

    await permissionService.createCustomRole({
      name: 'Special Operators',
      scope: 'engine',
      permissionIds: ['engine:custom:operate-special'],
      createdById: 'admin-1',
    });

    expect(permissionInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        permissionId: 'engine:custom:operate-special',
      }),
    ]);
  });

  it('records stable provenance for config-managed custom roles', async () => {
    const roleInsert = vi.fn().mockResolvedValue(undefined);
    const permissionDelete = vi.fn().mockResolvedValue(undefined);
    const permissionInsert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { insert: roleInsert };
        if (entity === RbacRolePermission) return { delete: permissionDelete, insert: permissionInsert };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction: async (callback: any) => callback(manager),
      getRepository: (entity: unknown) => {
        if (entity === RbacPermission) return { find: vi.fn().mockResolvedValue([]) };
        throw new Error('Unexpected repository');
      },
    });

    await permissionService.createCustomRole({
      key: 'custom.engine.deployment-operator',
      name: 'Deployment Operator',
      scope: 'engine',
      permissionIds: [EnginePermissions.DEPLOY],
      createdById: 'config-bot',
      tenantId: 'tenant-a',
      source: 'config',
      sourceRef: 'bundle:acme.authz',
    });

    expect(roleInsert).toHaveBeenCalledWith(expect.objectContaining({
      key: 'custom.engine.deployment-operator',
      roleKeyIdentity: 'tenant-a:custom.engine.deployment-operator',
      source: 'config',
      sourceRef: 'bundle:acme.authz',
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('bundle:acme.authz'),
    }));
  });

  it('exposes deterministic system roles', () => {
    const roles = permissionService.getSystemRoles();

    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_ADMIN)?.permissions).toContain(PlatformPermissions.AUTHZ_ROLES_VIEW);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_DEVELOPER)).toMatchObject({
      scope: 'platform',
      isAssignable: false,
      permissions: [
        PlatformPermissions.DASHBOARD_VIEW,
        PlatformPermissions.PROJECT_CREATE,
        PlatformPermissions.ENGINE_CREATE,
        PlatformPermissions.USER_VIEW,
        PlatformPermissions.USERS_VIEW,
      ],
    });
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_USER)).toMatchObject({
      scope: 'platform',
      isAssignable: true,
      permissions: [
        PlatformPermissions.DASHBOARD_VIEW,
        PlatformPermissions.PROJECT_CREATE,
        PlatformPermissions.ENGINE_CREATE,
      ],
    });
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_ACCESS_ADMIN)).toMatchObject({
      scope: 'platform',
      isAssignable: true,
      permissions: [
        PlatformPermissions.AUTHZ_ROLES_VIEW,
        PlatformPermissions.AUTHZ_ROLES_MANAGE,
        PlatformPermissions.AUTHZ_CHECK,
        PlatformPermissions.AUDIT_VIEW,
      ],
    });
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_ACCESS_AUDITOR)).toMatchObject({
      scope: 'platform',
      isAssignable: true,
      permissions: [
        PlatformPermissions.AUTHZ_ROLES_VIEW,
        PlatformPermissions.AUTHZ_CHECK,
        PlatformPermissions.AUDIT_VIEW,
      ],
    });
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_USER_ADMIN)?.permissions).toEqual([
      PlatformPermissions.USER_VIEW,
      PlatformPermissions.USERS_VIEW,
      PlatformPermissions.USERS_CREATE,
      PlatformPermissions.USERS_UPDATE,
      PlatformPermissions.USERS_DEACTIVATE,
      PlatformPermissions.USERS_DELETE,
      PlatformPermissions.USERS_UNLOCK,
    ]);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_SSO_ADMIN)?.permissions).toEqual([
      PlatformPermissions.SSO_ASSIGNMENTS_VIEW,
      PlatformPermissions.SSO_ASSIGNMENTS_MANAGE,
      PlatformPermissions.SSO_PROVIDERS_VIEW,
      PlatformPermissions.SSO_PROVIDERS_MANAGE,
      PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_VIEW,
      PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_MANAGE,
    ]);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_ENGINE_REGISTRY_ADMIN)?.permissions).toEqual([
      PlatformPermissions.ENGINE_REGISTRATION_MANAGE,
      PlatformPermissions.ENGINE_SETS_VIEW,
      PlatformPermissions.ENGINE_SETS_MANAGE,
      PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW,
      PlatformPermissions.PROJECT_ENGINE_TARGETS_MANAGE,
      PlatformPermissions.ENGINE_CREATE,
      PlatformPermissions.ENGINE_DELETE,
    ]);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PLATFORM_API_CLIENT_ADMIN)?.permissions).toEqual([
      PlatformPermissions.API_CLIENTS_VIEW,
      PlatformPermissions.API_CLIENTS_MANAGE,
      PlatformPermissions.SERVICE_ACCOUNTS_VIEW,
      PlatformPermissions.SERVICE_ACCOUNTS_MANAGE,
    ]);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OPERATOR)?.permissions).toContain(EnginePermissions.INSTANCE_VIEW);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_DEPLOYER)?.permissions).toEqual([
      EnginePermissions.DEPLOY,
      EnginePermissions.DEPLOY_VIEW,
    ]);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OWNER)?.permissions).toContain(EnginePermissions.DELEGATE_MANAGE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OWNER)?.permissions).toContain(EnginePermissions.OWNERSHIP_TRANSFER);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OWNER)?.permissions).toContain(EnginePermissions.SECRETS_VIEW);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OWNER)?.permissions).toContain(EnginePermissions.SECRETS_MANAGE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OWNER)?.permissions).toContain(EnginePermissions.MEMBERS_ADD);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OWNER)?.permissions).toContain(EnginePermissions.PROJECT_ACCESS_APPROVE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OPERATOR)?.permissions).not.toContain(EnginePermissions.SECRETS_VIEW);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_OPERATOR)?.permissions).not.toContain(EnginePermissions.SECRETS_MANAGE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_DELEGATE)?.permissions).toContain(EnginePermissions.MEMBERS_INVITE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_DELEGATE)?.permissions).toContain(EnginePermissions.ENVIRONMENT_SET);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_DELEGATE)?.permissions).toContain(EnginePermissions.SECRETS_VIEW);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_DELEGATE)?.permissions).toContain(EnginePermissions.SECRETS_MANAGE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_DELEGATE)?.permissions).not.toContain(EnginePermissions.OWNERSHIP_TRANSFER);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PROJECT_OWNER)?.permissions).toContain(ProjectPermissions.DELEGATE_MANAGE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PROJECT_OWNER)?.permissions).toContain(ProjectPermissions.OWNERSHIP_TRANSFER);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PROJECT_OWNER)?.permissions).toContain(ProjectPermissions.MEMBERS_ADD);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PROJECT_DELEGATE)?.permissions).toContain(ProjectPermissions.MEMBERS_INVITE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PROJECT_DELEGATE)?.permissions).toContain(ProjectPermissions.MEMBERS_UPDATE_ROLE);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PROJECT_DELEGATE)?.permissions).not.toContain(ProjectPermissions.OWNERSHIP_TRANSFER);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.PROJECT_DEPLOYER)?.permissions).toEqual([
      ProjectPermissions.DEPLOY,
    ]);
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR)).toMatchObject({
      scope: 'external_engine_system',
      isAssignable: true,
      permissions: [ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE],
    });
    expect(roles.find((role) => role.id === SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR)).toMatchObject({
      scope: 'external_engine_system',
      isAssignable: true,
      permissions: [ExternalEngineSystemPermissions.PROJECT_TARGETS_MANAGE],
    });
  });

  it('returns current user permission snapshots for known project and engine scopes', async () => {
    const projectAssignmentQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ resourceId: null, scopeId: 'project-rbac' }]),
    };
    const engineAssignmentQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ resourceId: null, scopeId: 'engine-rbac' }]),
    };
    const engineSetAssignmentQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const runtimeAssignmentQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const grantQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn()
        .mockReturnValueOnce(projectAssignmentQb)
        .mockReturnValueOnce(engineAssignmentQb)
        .mockReturnValueOnce(engineSetAssignmentQb)
        .mockReturnValueOnce(runtimeAssignmentQb),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === User) return { findOne: vi.fn().mockResolvedValue({ id: 'user-1', platformRole: 'admin' }) };
        if (entity === Project) return { find: vi.fn().mockResolvedValue([{ id: 'project-owned' }]) };
        if (entity === ProjectMember) return { find: vi.fn().mockResolvedValue([{ projectId: 'project-member' }]) };
        if (entity === ProjectMemberRole) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([{ id: 'engine-owned' }]) };
        if (entity === EngineMember) return { find: vi.fn().mockResolvedValue([{ engineId: 'engine-member' }]) };
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    });

    const snapshot = await permissionService.getCurrentUserPermissions('user-1');

    expect(snapshot.userId).toBe('user-1');
    expect(snapshot.authorizationVersion).toMatch(/^authz:/);
    expect(snapshot.platform).toContain(PlatformPermissions.USER_VIEW);
    expect(snapshot.projects.map((project) => project.resourceId)).toEqual([
      'project-member',
      'project-owned',
      'project-rbac',
    ]);
    expect(snapshot.engines.map((engine) => engine.resourceId)).toEqual([
      'engine-member',
      'engine-owned',
      'engine-rbac',
    ]);
    expect(snapshot.projects[0].permissions).toContain(ProjectPermissions.FILES_VIEW);
    expect(snapshot.engines[0].permissions).toContain(EnginePermissions.INSTANCE_VIEW);
  });

  it('keeps legacy role permission behavior', () => {
    expect(permissionService.roleHasPermission(PlatformPermissions.USER_VIEW, { platformRole: 'developer' })).toBe(true);
    expect(permissionService.roleHasPermission(PlatformPermissions.USER_MANAGE, { platformRole: 'developer' })).toBe(false);
    expect(permissionService.roleHasPermission(ProjectPermissions.DEPLOY, { projectRole: 'developer' })).toBe(true);
    expect(permissionService.roleHasPermission(ProjectPermissions.DEPLOY, { projectRole: 'editor' })).toBe(false);
    expect(permissionService.roleHasPermission(EnginePermissions.ENGINE_EDIT, { engineRole: 'operator' })).toBe(false);
    expect(permissionService.roleHasPermission(ProjectPermissions.PROJECT_DELETE, { projectRole: 'owner' })).toBe(true);
    expect(permissionService.roleHasPermission(ProjectPermissions.PROJECT_DELETE, { projectRole: 'delegate' })).toBe(false);
    expect(permissionService.roleHasPermission(ProjectPermissions.DELEGATE_MANAGE, { projectRole: 'owner' })).toBe(true);
    expect(permissionService.roleHasPermission(ProjectPermissions.DELEGATE_MANAGE, { projectRole: 'delegate' })).toBe(false);
    expect(permissionService.roleHasPermission(ProjectPermissions.OWNERSHIP_TRANSFER, { projectRole: 'owner' })).toBe(true);
    expect(permissionService.roleHasPermission(ProjectPermissions.OWNERSHIP_TRANSFER, { projectRole: 'delegate' })).toBe(false);
    expect(permissionService.roleHasPermission(ProjectPermissions.MEMBERS_ADD, { projectRole: 'delegate' })).toBe(true);
    expect(permissionService.roleHasPermission(ProjectPermissions.MEMBERS_REMOVE, { projectRole: 'developer' })).toBe(false);
    expect(permissionService.roleHasPermission(ProjectPermissions.FILES_VIEW, { projectRole: 'viewer' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.MEMBERS_MANAGE, { engineRole: 'delegate' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.MEMBERS_ADD, { engineRole: 'delegate' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.SECRETS_VIEW, { engineRole: 'delegate' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.SECRETS_MANAGE, { engineRole: 'delegate' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.SECRETS_VIEW, { engineRole: 'operator' })).toBe(false);
    expect(permissionService.roleHasPermission(EnginePermissions.MEMBERS_REMOVE, { engineRole: 'operator' })).toBe(false);
    expect(permissionService.roleHasPermission(EnginePermissions.PROJECT_ACCESS_APPROVE, { engineRole: 'delegate' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.PROJECT_ACCESS_APPROVE, { engineRole: 'operator' })).toBe(false);
    expect(permissionService.roleHasPermission(EnginePermissions.ENVIRONMENT_LOCK, { engineRole: 'delegate' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.DELEGATE_MANAGE, { engineRole: 'owner' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.DELEGATE_MANAGE, { engineRole: 'delegate' })).toBe(false);
    expect(permissionService.roleHasPermission(EnginePermissions.OWNERSHIP_TRANSFER, { engineRole: 'owner' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.OWNERSHIP_TRANSFER, { engineRole: 'delegate' })).toBe(false);
    expect(permissionService.roleHasPermission(EnginePermissions.DEPLOY, { engineRole: 'deployer' })).toBe(true);
    expect(permissionService.roleHasPermission(EnginePermissions.PROCESS_START, { engineRole: 'deployer' })).toBe(false);
  });

  it('keeps engine deployer deployment-focused without Mission Control mutation permissions', () => {
    expect(EngineRolePermissions.deployer).toEqual([
      EnginePermissions.DEPLOY,
      EnginePermissions.DEPLOY_VIEW,
    ]);

    const missionControlMutationPermissions = [
      EnginePermissions.PROCESS_START,
      EnginePermissions.PROCESS_CANCEL,
      EnginePermissions.PROCESS_MODIFY,
      EnginePermissions.INSTANCE_DELETE,
      EnginePermissions.INSTANCE_RETRY,
      EnginePermissions.VARIABLES_EDIT,
    ];

    for (const permission of missionControlMutationPermissions) {
      expect(EngineRolePermissions.deployer).not.toContain(permission);
      expect(permissionService.roleHasPermission(permission, { engineRole: 'deployer' })).toBe(false);
    }
  });

  it('returns deny explanations when no authorization source matches', async () => {
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(PlatformPermissions.USER_MANAGE, {
      userId: 'user-1',
      platformRole: 'user',
    });

    expect(result).toEqual({ allowed: false, reason: 'no-permission', sources: [] });
  });

  it('rejects manual assignments to non-assignable system roles', async () => {
    const roleRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: SYSTEM_ROLE_IDS.ENGINE_OWNER,
        scope: 'engine',
        isArchived: false,
        isAssignable: false,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return roleRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      userId: '00000000-0000-4000-8000-000000000001',
      roleId: SYSTEM_ROLE_IDS.ENGINE_OWNER,
      resourceType: 'engine',
      resourceId: 'engine-1',
      createdById: 'admin-1',
    })).rejects.toThrow('Role is not assignable');
  });

  it('rejects runtime-resource assignments when the containing engine is engine-wide', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: vi.fn().mockResolvedValue({ id: 'custom.engine.viewer', scope: 'engine', kind: 'custom', tenantId: null, isArchived: false, isAssignable: true }) };
        if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue({ id: 'group-1', isArchived: false }) };
        if (entity === RuntimeResource) return { findOne: vi.fn().mockResolvedValue({ id: 'runtime-1', engineId: 'engine-1' }) };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', runtimeAccessScope: 'engine_wide' }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      principalType: 'group', principalId: 'group-1', roleId: 'custom.engine.viewer',
      scopeType: 'engine_runtime_resource', scopeId: 'runtime-1', createdById: 'admin-1',
    })).rejects.toThrow('Runtime resource assignments require an engine with resource-aware runtime access');
  });

  it('preserves runtime-resource scope type for resource-aware engine assignments', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = { where: vi.fn().mockReturnThis(), getOne: vi.fn().mockResolvedValue(null) };
    const rolePermissionFind = vi.fn()
      .mockResolvedValueOnce([{ permissionId: EnginePermissions.INSTANCE_VIEW }])
      .mockResolvedValueOnce([{ permissionId: EnginePermissions.INSTANCE_VIEW }]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: vi.fn().mockResolvedValue({ id: 'custom.engine.viewer', scope: 'engine', kind: 'custom', tenantId: null, isArchived: false, isAssignable: true }) };
        if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue({ id: 'group-1', isArchived: false }) };
        if (entity === RuntimeResource) return { findOne: vi.fn().mockResolvedValue({ id: 'runtime-1', engineId: 'engine-1' }) };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', runtimeAccessScope: 'resource_aware' }) };
        if (entity === RbacRolePermission) return { find: rolePermissionFind };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(duplicateQb), insert: insertAssignment, find: vi.fn().mockResolvedValue([{ roleId: 'system.engine.operator', source: 'manual', expiresAt: null }]) };
        if (entity === AuditLog) return { insert: vi.fn().mockResolvedValue(undefined) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'group', principalId: 'group-1', roleId: 'custom.engine.viewer',
      scopeType: 'engine_runtime_resource', scopeId: 'runtime-1', createdById: 'admin-1',
    });

    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({ scopeType: 'engine_runtime_resource', scopeId: 'runtime-1' }));
    expect(result.warnings).toEqual([expect.stringContaining(EnginePermissions.INSTANCE_VIEW)]);
  });

  it('allows API clients to receive the machine-safe project deployer system role', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
            scope: 'project',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ApiClient) return { findOne: vi.fn().mockResolvedValue({ id: 'api-client-1', isActive: true }) };
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1' }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(duplicateQb),
          insert: insertAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: 'project',
      resourceId: 'project-1',
      createdById: 'admin-1',
    });

    expect(result.id).toBeTruthy();
    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: null,
      resourceId: null,
      scopeType: 'project',
      scopeId: 'project-1',
    }));
  });

  it('allows API clients to receive the API engine registrar system role', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
            scope: 'platform',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ApiClient) return { findOne: vi.fn().mockResolvedValue({ id: 'api-client-1', isActive: true }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(duplicateQb),
          insert: insertAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
      resourceType: 'platform',
      resourceId: null,
      createdById: 'admin-1',
    });

    expect(result.id).toBeTruthy();
    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
      resourceType: null,
      resourceId: null,
      scopeType: 'platform',
      scopeId: null,
    }));
  });

  it('allows API clients to receive the external-system scoped engine registrar system role', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR,
            scope: 'external_engine_system',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ApiClient) return { findOne: vi.fn().mockResolvedValue({ id: 'api-client-1', isActive: true }) };
        if (entity === ExternalEngineSystem) return { findOne: vi.fn().mockResolvedValue({ id: 'system-1', isActive: true }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(duplicateQb),
          insert: insertAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR,
      resourceType: 'external_engine_system',
      resourceId: 'system-1',
      createdById: 'admin-1',
    });

    expect(result.id).toBeTruthy();
    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR,
      resourceType: null,
      resourceId: null,
      scopeType: 'external_engine_system',
      scopeId: 'system-1',
    }));
  });

  it('allows API clients to receive the external-system scoped project target registrar system role', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR,
            scope: 'external_engine_system',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ApiClient) return { findOne: vi.fn().mockResolvedValue({ id: 'api-client-1', isActive: true }) };
        if (entity === ExternalEngineSystem) return { findOne: vi.fn().mockResolvedValue({ id: 'system-1', isActive: true }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(duplicateQb),
          insert: insertAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR,
      resourceType: 'external_engine_system',
      resourceId: 'system-1',
      createdById: 'admin-1',
    });

    expect(result.id).toBeTruthy();
    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR,
      resourceType: null,
      resourceId: null,
      scopeType: 'external_engine_system',
      scopeId: 'system-1',
    }));
  });

  it('rejects service-account assignments to the API engine registrar system role', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
            scope: 'platform',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ServiceAccount) return { findOne: vi.fn().mockResolvedValue({ id: 'service-account-1', isActive: true }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      principalType: 'service_account',
      principalId: 'service-account-1',
      roleId: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
      resourceType: 'platform',
      resourceId: null,
      createdById: 'admin-1',
    })).rejects.toThrow('Role is assignable only to API client principals');
  });

  it('rejects service-account assignments to platform-scoped machine custom roles', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'custom.platform.engine-registrar',
            scope: 'platform',
            kind: 'custom',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ServiceAccount) return { findOne: vi.fn().mockResolvedValue({ id: 'service-account-1', isActive: true }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      principalType: 'service_account',
      principalId: 'service-account-1',
      roleId: 'custom.platform.engine-registrar',
      resourceType: 'platform',
      resourceId: null,
      createdById: 'admin-1',
    })).rejects.toThrow('Platform machine roles are assignable only to API client principals');
  });

  it('allows group principals to receive scoped role assignments', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
            scope: 'project',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue({ id: 'group-1', isArchived: false }) };
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1' }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(duplicateQb),
          insert: insertAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'group',
      principalId: 'group-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: 'project',
      resourceId: 'project-1',
      createdById: 'admin-1',
    });

    expect(result.id).toBeTruthy();
    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      principalType: 'group',
      principalId: 'group-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: null,
      resourceId: null,
      scopeType: 'project',
      scopeId: 'project-1',
    }));
  });

  it('rejects group role assignments when the group is missing or archived', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
            scope: 'project',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue({ id: 'group-1', isArchived: true }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      principalType: 'group',
      principalId: 'group-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: 'project',
      resourceId: 'project-1',
      createdById: 'admin-1',
    })).rejects.toThrow('Group not found or archived');
  });

  it('rejects API-client assignments to human/admin system roles', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
            scope: 'platform',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ApiClient) return { findOne: vi.fn().mockResolvedValue({ id: 'api-client-1', isActive: true }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
      resourceType: 'platform',
      resourceId: null,
      createdById: 'admin-1',
    })).rejects.toThrow('Role is not assignable to machine principals');
  });

  it('rejects API-client assignments to custom roles with unsafe permissions', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'custom.project.editor',
            scope: 'project',
            kind: 'custom',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ApiClient) return { findOne: vi.fn().mockResolvedValue({ id: 'api-client-1', isActive: true }) };
        if (entity === RbacRolePermission) return {
          find: vi.fn().mockResolvedValue([
            { permissionId: ProjectPermissions.DEPLOY },
            { permissionId: ProjectPermissions.FILES_EDIT },
          ]),
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: 'custom.project.editor',
      resourceType: 'project',
      resourceId: 'project-1',
      createdById: 'admin-1',
    })).rejects.toThrow('unsafe permissions: project:files:edit');
  });

  it('allows active service accounts to receive machine-safe roles', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
            scope: 'project',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ServiceAccount) return { findOne: vi.fn().mockResolvedValue({ id: 'service-account-1', isActive: true }) };
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1' }) };
        if (entity === RbacRoleAssignment) return {
          createQueryBuilder: vi.fn().mockReturnValue(duplicateQb),
          insert: insertAssignment,
        };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'service_account',
      principalId: 'service-account-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: 'project',
      resourceId: 'project-1',
      createdById: 'admin-1',
    });

    expect(result.id).toBeTruthy();
    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      principalType: 'service_account',
      principalId: 'service-account-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: null,
      resourceId: null,
      scopeType: 'project',
      scopeId: 'project-1',
    }));
  });

  it('rejects inactive service-account role assignments', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
            scope: 'project',
            kind: 'system',
            tenantId: null,
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === ServiceAccount) return { findOne: vi.fn().mockResolvedValue({ id: 'service-account-1', isActive: false }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      principalType: 'service_account',
      principalId: 'service-account-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
      resourceType: 'project',
      resourceId: 'project-1',
      createdById: 'admin-1',
    })).rejects.toThrow('Service account not found or inactive');
  });

  it('rejects custom roles with permissions from another scope', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({});

    await expect(permissionService.createCustomRole({
      name: 'Bad engine role',
      scope: 'engine',
      permissionIds: [ProjectPermissions.FILES_VIEW],
      createdById: 'admin-1',
    })).rejects.toThrow('does not match engine role scope');
  });

  it('rejects deny permissions on custom roles to preserve additive RBAC semantics', async () => {
    await expect(permissionService.createCustomRole({
      name: 'Deny role',
      scope: 'engine',
      permissionIds: [EnginePermissions.DEPLOY_VIEW],
      denyPermissionIds: [EnginePermissions.DEPLOY],
      createdById: 'admin-1',
    } as any)).rejects.toThrow('Custom roles are allow-only; use authorization policies for deny rules');

    await expect(permissionService.updateCustomRole('custom.engine.role', {
      deniedPermissionIds: [EnginePermissions.DEPLOY],
      updatedById: 'admin-1',
    } as any)).rejects.toThrow('Custom roles are allow-only; use authorization policies for deny rules');
  });

  it('keeps seeded system roles read-only', async () => {
    const roleRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
        kind: 'system',
        isEditable: false,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return roleRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.updateCustomRole(SYSTEM_ROLE_IDS.PLATFORM_ADMIN, {
      name: 'Changed',
    })).rejects.toThrow('System roles cannot be edited');
  });

  it('writes audit records for custom role lifecycle changes', async () => {
    const roleInsert = vi.fn().mockResolvedValue(undefined);
    const roleUpdate = vi.fn().mockResolvedValue(undefined);
    const permissionDelete = vi.fn().mockResolvedValue(undefined);
    const permissionInsert = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { insert: roleInsert, update: roleUpdate };
        if (entity === RbacRolePermission) return { delete: permissionDelete, insert: permissionInsert };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    };
    const roleRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'role-1',
        name: 'Operators',
        scope: 'engine',
        kind: 'custom',
        isEditable: true,
        isArchived: false,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction: async (callback: any) => callback(manager),
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return roleRepo;
        throw new Error('Unexpected repository');
      },
    });

    const created = await permissionService.createCustomRole({
      name: 'Operators',
      scope: 'engine',
      permissionIds: [EnginePermissions.DEPLOY],
      createdById: 'admin-1',
    });

    expect(created.id).toBeTruthy();
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      action: 'authz.role.create',
      resourceType: 'role',
      details: expect.stringContaining('engine:deploy'),
    }));

    await permissionService.archiveCustomRole('role-1', 'admin-1');
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      action: 'authz.role.archive',
      resourceType: 'role',
      resourceId: 'role-1',
    }));
  });

  it('writes audit records for manual role assignment create and delete', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const deleteAssignment = vi.fn().mockResolvedValue(undefined);
    const auditInsert = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    const assignmentRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(duplicateQb),
      insert: insertAssignment,
      findOne: vi.fn().mockResolvedValue({
        id: 'assignment-1',
        userId: 'user-1',
        roleId: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
        resourceType: 'engine',
        resourceId: 'engine-1',
        source: 'manual',
      }),
      delete: deleteAssignment,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return {
          findOne: vi.fn().mockResolvedValue({
            id: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
            scope: 'engine',
            isArchived: false,
            isAssignable: true,
          }),
        };
        if (entity === User) return { findOne: vi.fn().mockResolvedValue({ id: 'user-1' }) };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1' }) };
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    });

    const assigned = await permissionService.assignRole({
      userId: 'user-1',
      roleId: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
      resourceType: 'engine',
      resourceId: 'engine-1',
      createdById: 'admin-1',
    });

    expect(assigned.id).toBeTruthy();
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      action: 'authz.role_assignment.create',
      resourceType: 'role_assignment',
      details: expect.stringContaining('system.engine.operator'),
    }));

    await permissionService.removeRoleAssignment('assignment-1', 'admin-1');
    expect(deleteAssignment).toHaveBeenCalledWith({ id: 'assignment-1' });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      action: 'authz.role_assignment.delete',
      resourceType: 'role_assignment',
      resourceId: 'assignment-1',
    }));
  });

  it('syncs legacy project and engine memberships into source=legacy role assignments', async () => {
    const assignmentFind = vi.fn().mockResolvedValue([
      { id: 'legacy:project:project-1:stale-user:system.project.viewer' },
    ]);
    const assignmentDelete = vi.fn().mockResolvedValue(undefined);
    const assignmentUpsert = vi.fn().mockResolvedValue(undefined);
    const projectRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'project-1', ownerId: 'owner-1', tenantId: 'tenant-1', createdAt: 10, updatedAt: 20 },
      ]),
    };
    const projectMemberRepo = {
      find: vi.fn().mockResolvedValue([
        { projectId: 'project-1', userId: 'developer-1', role: 'developer', joinedAt: 11, createdAt: 11 },
      ]),
    };
    const projectMemberRoleRepo = {
      find: vi.fn().mockResolvedValue([
        { projectId: 'project-1', userId: 'viewer-1', role: 'viewer', createdAt: 12 },
      ]),
    };
    const engineRepo = {
      find: vi.fn().mockResolvedValue([
        { id: 'engine-1', ownerId: 'engine-owner-1', delegateId: 'delegate-1', tenantId: 'tenant-1', createdAt: 30, updatedAt: 40 },
      ]),
    };
    const engineMemberRepo = {
      find: vi.fn().mockResolvedValue([
        { engineId: 'engine-1', userId: 'operator-1', role: 'operator', createdAt: 31 },
      ]),
    };
    const assignmentRepo = {
      find: assignmentFind,
      delete: assignmentDelete,
      upsert: assignmentUpsert,
    };

    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === ProjectMemberRole) return projectMemberRoleRepo;
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return engineMemberRepo;
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    } as any;

    const result = await permissionService.syncLegacyRoleAssignments({ now: 123 }, dataSource);

    expect(result).toEqual({ scannedProjects: 1, scannedEngines: 1, upserted: 6, removed: 1 });
    expect(assignmentDelete).toHaveBeenCalledWith(expect.objectContaining({ id: expect.anything() }));
    expect(assignmentUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy:project:project-1:owner-1:system.project.owner',
          tenantId: 'tenant-1',
          userId: 'owner-1',
          roleId: SYSTEM_ROLE_IDS.PROJECT_OWNER,
          resourceType: 'project',
          resourceId: 'project-1',
          source: 'legacy',
          lastSeenAt: 123,
        }),
        expect.objectContaining({
          id: 'legacy:project:project-1:developer-1:system.project.developer',
          roleId: SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
        }),
        expect.objectContaining({
          id: 'legacy:engine:engine-1:engine-owner-1:system.engine.owner',
          roleId: SYSTEM_ROLE_IDS.ENGINE_OWNER,
        }),
        expect.objectContaining({
          id: 'legacy:engine:engine-1:delegate-1:system.engine.delegate',
          roleId: SYSTEM_ROLE_IDS.ENGINE_DELEGATE,
        }),
        expect.objectContaining({
          id: 'legacy:engine:engine-1:operator-1:system.engine.operator',
          roleId: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
        }),
      ]),
      expect.objectContaining({
        conflictPaths: ['id'],
        skipUpdateIfNoValuesChanged: true,
      }),
    );
  });
});
