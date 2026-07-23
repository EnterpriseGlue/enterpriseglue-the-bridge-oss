import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  EnginePermissions,
  EngineRolePermissions,
  ExternalEngineSystemPermissions,
  PermissionCatalog,
  type PermissionContext,
  PlatformPermissions,
  ProjectRolePermissions,
  ProjectPermissions,
  SYSTEM_ROLE_IDS,
  SystemRoleDefinitions,
  annotateRuntimeGrantShadowing,
  permissionService,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { listAuthzActions } from '@enterpriseglue/shared/authz/permission-actions.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  AuditLog,
  ApiClient,
  AuthzGroup,
  AuthzGroupMembership,
  ConfigRoleAssignmentOverride,
  ConfigBundleApplyRun,
  Engine,
  EngineSet,
  EngineSetMaterialization,
  EngineMember,
  ExternalEngineRegistration,
  ExternalEngineSystem,
  IdentityEntitlementMapping,
  PermissionGrant,
  Project,
  ProjectMember,
  ProjectMemberRole,
  RbacPermission,
  RbacRole,
  RbacRoleAssignment,
  RbacRolePermission,
  RuntimeResource,
  RuntimeResourceSet,
  ServiceAccount,
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
  it('labels engine-wide grants that shadow matching narrower runtime grants', () => {
    const result = annotateRuntimeGrantShadowing([
      { type: 'role-assignment', assignmentId: 'engine-grant', scopeType: 'engine', scopeId: 'engine-1' },
      { type: 'role-assignment', assignmentId: 'runtime-grant', scopeType: 'engine_runtime_resource', scopeId: 'runtime-1' },
      { type: 'role-assignment', assignmentId: 'runtime-set-grant', scopeType: 'engine_runtime_resource_set', scopeId: 'runtime-set-1' },
    ]);

    expect(result[0]).toMatchObject({
      assignmentId: 'engine-grant',
      shadowedRuntimeAssignmentIds: ['runtime-grant', 'runtime-set-grant'],
    });
    expect(result[1]).not.toHaveProperty('shadowedRuntimeAssignmentIds');
  });

  it('reads fresh runtime inventory on consecutive visibility evaluations', async () => {
    const find = vi.fn()
      .mockResolvedValueOnce([{ id: 'runtime-a', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'orders', isActive: true }])
      .mockResolvedValueOnce([{ id: 'runtime-b', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'payments', isActive: true }]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === RuntimeResource ? { find } : undefined,
    });
    const evaluation = vi.spyOn(permissionService, 'evaluatePermission').mockResolvedValue({
      allowed: true,
      reason: 'test',
      sources: [],
    });

    const input = {
      userId: 'user-1',
      tenantId: null,
      engineId: 'engine-1',
      resourceKind: 'process_definition' as const,
      permission: 'engine:instance:view',
    };
    const first = await permissionService.getVisibleRuntimeResources(input);
    const second = await permissionService.getVisibleRuntimeResources(input);

    expect(first.map((resource) => resource.id)).toEqual(['runtime-a']);
    expect(second.map((resource) => resource.id)).toEqual(['runtime-b']);
    expect(find).toHaveBeenCalledTimes(2);
    evaluation.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not grant access from a legacy platform role field', async () => {
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const grantQb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    const groupMembership = createGroupMembershipRepo();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRolePermission || entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const legacyContext: PermissionContext & { platformRole: string } = {
      userId: 'user-1',
      platformRole: 'admin',
    };
    const result = await permissionService.hasPermission(PlatformPermissions.USER_VIEW, legacyContext);
    expect(result).toBe(false);
  });

  it('ignores legacy member rows and owner/delegate metadata without canonical assignments', async () => {
    const emptyQb = {
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
      getOne: vi.fn().mockResolvedValue(null),
    };
    const groupMembership = createGroupMembershipRepo();
    const projectRepo = { findOne: vi.fn().mockResolvedValue({ id: 'project-1', ownerId: 'user-1' }) };
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([{ projectId: 'project-1', userId: 'user-1', role: 'owner' }]) };
    const projectMemberRoleRepo = { find: vi.fn().mockResolvedValue([{ projectId: 'project-1', userId: 'user-1', role: 'delegate' }]) };
    const engineRepo = { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', ownerId: 'user-1', delegateId: 'user-1' }) };
    const engineMemberRepo = { find: vi.fn().mockResolvedValue([{ engineId: 'engine-1', userId: 'user-1', role: 'owner' }]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === RbacRoleAssignment || entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(emptyQb) };
        if (entity === Project) return projectRepo;
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === ProjectMemberRole) return projectMemberRoleRepo;
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return engineMemberRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.evaluatePermission(ProjectPermissions.PROJECT_SETTINGS, {
      userId: 'user-1', resourceType: 'project', resourceId: 'project-1',
    })).resolves.toEqual({ allowed: false, reason: 'no-permission', sources: [] });
    await expect(permissionService.evaluatePermission(EnginePermissions.ENGINE_EDIT, {
      userId: 'user-1', resourceType: 'engine', resourceId: 'engine-1',
    })).resolves.toEqual({ allowed: false, reason: 'no-permission', sources: [] });
    await expect(permissionService.getKnownProjectIdsForUser('user-1')).resolves.toEqual([]);
    await expect(permissionService.getKnownEngineIdsForUser('user-1')).resolves.toEqual([]);

    expect(projectRepo.findOne).not.toHaveBeenCalled();
    expect(projectMemberRepo.find).not.toHaveBeenCalled();
    expect(projectMemberRoleRepo.find).not.toHaveBeenCalled();
    expect(engineRepo.findOne).not.toHaveBeenCalled();
    expect(engineMemberRepo.find).not.toHaveBeenCalled();
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
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.ENGINE_SETS_VIEW, {
      userId: 'user-1',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW, {
      userId: 'user-1',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.SSO_ASSIGNMENTS_VIEW, {
      userId: 'user-1',
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
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.API_CLIENTS_MANAGE, {
      userId: 'user-1',
      resourceType: 'platform',
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(PlatformPermissions.SERVICE_ACCOUNTS_VIEW, {
      userId: 'user-1',
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
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([{ id: 'engine-granted' }]) };
        if (entity === EngineMember) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.getKnownEngineIdsForUser('user-1', 'tenant-a');

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

  it('does not resolve retired mapping lineage for inherited group role assignments', async () => {
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
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRolePermission) return {};
        if (entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
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
    });
  });

  it('explains provider-neutral identity mapping lineage for inherited group role assignments', async () => {
    const assignmentQb = { innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), getMany: vi.fn().mockResolvedValue([{ id: 'assignment-identity-group-engine-deployer', roleId: 'group-engine-role', principalType: 'group', principalId: 'group-operators', source: 'manual', sourceMappingId: null, sourceRef: null }]) };
    const groupMembership = createGroupMembershipRepo(['group-operators']);
    groupMembership.repo.find.mockResolvedValue([{ id: 'membership-identity-operators', groupId: 'group-operators', userId: 'user-1', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-operators', expiresAt: null }]);
    const authzGroupRepo = { find: vi.fn().mockResolvedValue([{ id: 'group-operators', key: 'operators', name: 'Operators', isArchived: false }]) };
    const identityMappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'mapping-operators', providerId: 'identity.oidc.main', entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', targetGroupId: 'group-operators', syncMode: 'authoritative' }]) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === AuthzGroupMembership) return groupMembership.repo;
      if (entity === AuthzGroup) return authzGroupRepo;
      if (entity === IdentityEntitlementMapping) return identityMappingRepo;
      if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
      if (entity === RbacRolePermission || entity === RbacRole) return {};
      throw new Error('Unexpected repository');
    } });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, { userId: 'user-1', resourceType: 'engine', resourceId: 'engine-1' });

    expect(result.allowed).toBe(true);
    expect(result.sources[0]).toMatchObject({
      groupMembership: { id: 'membership-identity-operators', source: 'identity_provider', sourceRef: 'identity_mapping:mapping-operators' },
      identityEntitlementMapping: { id: 'mapping-operators', providerId: 'identity.oidc.main', entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', targetGroupId: 'group-operators', syncMode: 'authoritative' },
    });
  });

  it('does not infer provider-neutral lineage from retired assignment records', async () => {
    const assignmentQb = { innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), getMany: vi.fn().mockResolvedValue([{ id: 'assignment-converted-identity-group-engine-deployer', roleId: 'group-engine-role', principalType: 'group', principalId: 'group-operators', source: 'sso', sourceMappingId: null, sourceRef: 'identity_entitlement_mapping:mapping-operators' }]) };
    const groupMembership = createGroupMembershipRepo(['group-operators']);
    groupMembership.repo.find.mockResolvedValue([{ id: 'membership-manual-operators', groupId: 'group-operators', userId: 'user-1', source: 'manual', sourceRef: 'manual:add', expiresAt: null }]);
    const authzGroupRepo = { find: vi.fn().mockResolvedValue([{ id: 'group-operators', key: 'operators', name: 'Operators', isArchived: false }]) };
    const identityMappingRepo = { find: vi.fn().mockResolvedValue([{ id: 'mapping-operators', providerId: 'identity.oidc.main', entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', targetGroupId: 'group-operators', syncMode: 'authoritative' }]) };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === AuthzGroupMembership) return groupMembership.repo;
      if (entity === AuthzGroup) return authzGroupRepo;
      if (entity === IdentityEntitlementMapping) return identityMappingRepo;
      if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
      if (entity === RbacRolePermission || entity === RbacRole) return {};
      throw new Error('Unexpected repository');
    } });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, { userId: 'user-1', resourceType: 'engine', resourceId: 'engine-1' });

    expect(result.allowed).toBe(true);
    expect(result.sources[0]).toMatchObject({
      source: 'sso',
      sourceRef: 'identity_entitlement_mapping:mapping-operators',
      groupMembership: { id: 'membership-manual-operators', source: 'manual', sourceRef: 'manual:add' },
      identityEntitlementMapping: null,
    });
  });

  it('explains configuration bundle lineage for config-managed role assignments', async () => {
    const assignmentQb = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'assignment-config-operators',
        roleId: 'role-config-operator',
        principalType: 'user',
        principalId: 'user-1',
        source: 'config',
        sourceMappingId: null,
        sourceRef: 'config_bundle:acme.authz',
        scopeType: 'project',
        scopeId: 'project-1',
        sourceHash: 'assignment-object-hash',
        lastAppliedAt: 1700000000000,
        driftStatus: 'in_sync',
        ownershipMode: 'config_locked',
      }]),
    };
    const groupMembership = createGroupMembershipRepo();
    const applyRunRepo = {
      find: vi.fn().mockResolvedValue([{
        id: 'apply-run-1',
        bundleKey: 'acme.authz',
        canonicalHash: 'bundle-canonical-hash',
        status: 'succeeded',
        completedAt: 1700000001000,
        createdAt: 1699999999000,
        updatedAt: 1700000001000,
      }]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === ConfigBundleApplyRun) return applyRunRepo;
        if (entity === RbacRolePermission || entity === RbacRole) return {};
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(ProjectPermissions.FILES_VIEW, {
      userId: 'user-1',
      resourceType: 'project',
      resourceId: 'project-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.sources[0]).toMatchObject({
      assignmentId: 'assignment-config-operators',
      source: 'config',
      configBundle: {
        bundleKey: 'acme.authz',
        sourceRef: 'config_bundle:acme.authz',
        objectType: 'role_assignment',
        objectId: 'assignment-config-operators',
        sourceHash: 'assignment-object-hash',
        lastAppliedAt: 1700000000000,
        driftStatus: 'in_sync',
        ownershipMode: 'config_locked',
        applyRun: {
          id: 'apply-run-1',
          canonicalHash: 'bundle-canonical-hash',
          appliedAt: 1700000001000,
        },
      },
    });
    expect(applyRunRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      order: { completedAt: 'DESC', createdAt: 'DESC' },
    }));
  });

  it('explains engine-set role assignment lineage without a legacy mapping lookup', async () => {
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
        source: 'manual',
        sourceMappingId: null,
        sourceRef: null,
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
        lineageJson: '{"source":"config","sourceRef":"config_bundle:engine-set-prod-operators"}',
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
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe(`role-assignment:${SYSTEM_ROLE_IDS.ENGINE_OPERATOR}`);
    expect(result.sources[0]).toMatchObject({
      type: 'role-assignment',
      assignmentId: 'assignment-sso-engine-set-operator',
      roleId: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
      source: 'manual',
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
    });
    expect(result.sources[0].matchedBy).toEqual({ mode: 'labels', labels: { environment: 'prod' } });
    expect(result.sources[0].lineage).toEqual({ source: 'config', sourceRef: 'config_bundle:engine-set-prod-operators' });
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
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1' }) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.evaluatePermission(EnginePermissions.DEPLOY, {
      userId: 'user-1',
      tenantId: 'tenant-a',
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
        PlatformPermissions.CONFIG_BUNDLES_VIEW,
        PlatformPermissions.CONFIG_BUNDLES_PREVIEW,
        PlatformPermissions.CONFIG_BUNDLES_APPLY,
        PlatformPermissions.CONFIG_BUNDLES_EXPORT,
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

  it('returns current user permission snapshots for canonical project and engine scopes', async () => {
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
    const catalogSpy = vi.spyOn(permissionService, 'getPermissionCatalog').mockResolvedValue([]);
    const versionSpy = vi.spyOn(permissionService as any, 'getAuthorizationVersion').mockResolvedValue('authz:test');

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === Project) return { find: vi.fn().mockResolvedValue([{ id: 'project-rbac' }]) };
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([{ id: 'engine-rbac' }]) };
        throw new Error('Unexpected repository');
      },
    });

    const snapshot = await permissionService.getCurrentUserPermissions('user-1');

    expect(snapshot.userId).toBe('user-1');
    expect(snapshot.authorizationVersion).toBe('authz:test');
    expect(snapshot.platform).toEqual([]);
    expect(snapshot.projects.map((project) => project.resourceId)).toEqual(['project-rbac']);
    expect(snapshot.engines.map((engine) => engine.resourceId)).toEqual(['engine-rbac']);
    catalogSpy.mockRestore();
    versionSpy.mockRestore();
  });

  it('discovers an explicitly granted project in the tenant-scoped permission snapshot', async () => {
    const grantQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ resourceId: 'project-direct' }]),
    };
    const assignmentQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const projectRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'project-direct' }]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.getKnownProjectIdsForUser('user-1', 'tenant-1')).resolves.toEqual(['project-direct']);
    expect(grantQb.andWhere).toHaveBeenCalledWith(
      '(grant.tenantId IN (:...tenantIds) OR grant.tenantId IS NULL)',
      { tenantIds: ['tenant-1'] },
    );
    expect(projectRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      select: ['id'],
    }));
  });

  it('discovers every tenant-visible project for a global direct project grant', async () => {
    const grantQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ resourceId: null }]),
    };
    const assignmentQb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const projectRepo = {
      find: vi.fn().mockResolvedValue([{ id: 'project-global' }, { id: 'project-shared' }]),
    };
    const groupMembership = createGroupMembershipRepo();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuthzGroupMembership) return groupMembership.repo;
        if (entity === PermissionGrant) return { createQueryBuilder: vi.fn().mockReturnValue(grantQb) };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.getKnownProjectIdsForUser('user-1', 'tenant-1')).resolves.toEqual([
      'project-global',
      'project-shared',
    ]);
    expect(projectRepo.find).toHaveBeenCalledWith({
      where: [{ tenantId: 'tenant-1' }, { tenantId: expect.anything() }],
      select: ['id'],
    });
  });

  it('seeds canonical system roles with the expected permissions', () => {
    const permissionsFor = (roleId: string) => SystemRoleDefinitions.find((role) => role.id === roleId)?.permissions || [];

    expect(permissionsFor(SYSTEM_ROLE_IDS.PLATFORM_DEVELOPER)).toContain(PlatformPermissions.USER_VIEW);
    expect(permissionsFor(SYSTEM_ROLE_IDS.PLATFORM_DEVELOPER)).not.toContain(PlatformPermissions.USER_MANAGE);
    expect(permissionsFor(SYSTEM_ROLE_IDS.PROJECT_DEVELOPER)).toContain(ProjectPermissions.DEPLOY);
    expect(permissionsFor(SYSTEM_ROLE_IDS.PROJECT_EDITOR)).not.toContain(ProjectPermissions.DEPLOY);
    expect(permissionsFor(SYSTEM_ROLE_IDS.ENGINE_OPERATOR)).not.toContain(EnginePermissions.ENGINE_EDIT);
    expect(permissionsFor(SYSTEM_ROLE_IDS.PROJECT_OWNER)).toEqual(expect.arrayContaining([
      ProjectPermissions.PROJECT_DELETE,
      ProjectPermissions.DELEGATE_MANAGE,
      ProjectPermissions.OWNERSHIP_TRANSFER,
    ]));
    expect(permissionsFor(SYSTEM_ROLE_IDS.PROJECT_DELEGATE)).toEqual(expect.arrayContaining([
      ProjectPermissions.MEMBERS_ADD,
    ]));
    expect(permissionsFor(SYSTEM_ROLE_IDS.PROJECT_DELEGATE)).not.toEqual(expect.arrayContaining([
      ProjectPermissions.PROJECT_DELETE,
      ProjectPermissions.DELEGATE_MANAGE,
      ProjectPermissions.OWNERSHIP_TRANSFER,
    ]));
    expect(permissionsFor(SYSTEM_ROLE_IDS.PROJECT_DEVELOPER)).not.toContain(ProjectPermissions.MEMBERS_REMOVE);
    expect(permissionsFor(SYSTEM_ROLE_IDS.PROJECT_VIEWER)).toContain(ProjectPermissions.FILES_VIEW);
    expect(permissionsFor(SYSTEM_ROLE_IDS.ENGINE_DELEGATE)).toEqual(expect.arrayContaining([
      EnginePermissions.MEMBERS_MANAGE,
      EnginePermissions.MEMBERS_ADD,
      EnginePermissions.SECRETS_VIEW,
      EnginePermissions.SECRETS_MANAGE,
      EnginePermissions.PROJECT_ACCESS_APPROVE,
      EnginePermissions.ENVIRONMENT_LOCK,
    ]));
    expect(permissionsFor(SYSTEM_ROLE_IDS.ENGINE_OPERATOR)).not.toEqual(expect.arrayContaining([
      EnginePermissions.SECRETS_VIEW,
      EnginePermissions.MEMBERS_REMOVE,
      EnginePermissions.PROJECT_ACCESS_APPROVE,
    ]));
    expect(permissionsFor(SYSTEM_ROLE_IDS.ENGINE_OWNER)).toEqual(expect.arrayContaining([
      EnginePermissions.DELEGATE_MANAGE,
      EnginePermissions.OWNERSHIP_TRANSFER,
    ]));
    expect(permissionsFor(SYSTEM_ROLE_IDS.ENGINE_DELEGATE)).not.toEqual(expect.arrayContaining([
      EnginePermissions.DELEGATE_MANAGE,
      EnginePermissions.OWNERSHIP_TRANSFER,
    ]));
    expect(permissionsFor(SYSTEM_ROLE_IDS.ENGINE_DEPLOYER)).toContain(EnginePermissions.DEPLOY);
    expect(permissionsFor(SYSTEM_ROLE_IDS.ENGINE_DEPLOYER)).not.toContain(EnginePermissions.PROCESS_START);
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
      expect(SystemRoleDefinitions.find((role) => role.id === SYSTEM_ROLE_IDS.ENGINE_DEPLOYER)?.permissions).not.toContain(permission);
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

  it('rejects a role assignment that names a group from another tenant', async () => {
    const groupRepo = { findOne: vi.fn().mockResolvedValue(null) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: vi.fn().mockResolvedValue({ id: 'custom.platform.viewer', scope: 'platform', kind: 'custom', tenantId: null, isArchived: false, isAssignable: true }) };
        if (entity === AuthzGroup) return groupRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      tenantId: 'tenant-a', principalType: 'group', principalId: 'foreign-group', roleId: 'custom.platform.viewer', createdById: 'admin-1',
    })).rejects.toThrow('Group not found or archived');

    expect(groupRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([expect.objectContaining({ id: 'foreign-group', tenantId: 'tenant-a' })]),
    }));
  });

  it('rejects another-tenant and unowned-dedicated engine assignment targets while allowing shared lookup', async () => {
    const engineRepo = { findOne: vi.fn().mockResolvedValue(null) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: vi.fn().mockResolvedValue({ id: 'custom.engine.viewer', scope: 'engine', kind: 'custom', tenantId: null, isArchived: false, isAssignable: true }) };
        if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue({ id: 'group-1', isArchived: false }) };
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.assignRole({
      tenantId: 'tenant-a', principalType: 'group', principalId: 'group-1', roleId: 'custom.engine.viewer', resourceType: 'engine', resourceId: 'foreign-engine', createdById: 'admin-1',
    })).rejects.toThrow('Engine not found');

    const where = engineRepo.findOne.mock.calls[0]?.[0]?.where;
    expect(where).toHaveLength(2);
    expect(where).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'foreign-engine', tenantId: 'tenant-a' }),
      expect.objectContaining({ id: 'foreign-engine', tenancyMode: 'shared' }),
    ]));
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
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(duplicateQb), insert: insertAssignment, find: vi.fn().mockResolvedValue([{ roleId: 'system.engine.operator', scopeType: 'engine', scopeId: 'engine-1', source: 'manual', expiresAt: null }]) };
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

  it('lets an engine-scoped role target a runtime-resource set without changing its role scope', async () => {
    const insertAssignment = vi.fn().mockResolvedValue(undefined);
    const duplicateQb = { where: vi.fn().mockReturnThis(), getOne: vi.fn().mockResolvedValue(null) };
    const rolePermissionFind = vi.fn().mockResolvedValue([{ permissionId: EnginePermissions.INSTANCE_VIEW }]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: vi.fn().mockResolvedValue({ id: 'custom.engine.viewer', scope: 'engine', kind: 'custom', tenantId: null, isArchived: false, isAssignable: true }) };
        if (entity === AuthzGroup) return { findOne: vi.fn().mockResolvedValue({ id: 'group-1', isArchived: false }) };
        if (entity === RuntimeResourceSet) return { findOne: vi.fn().mockResolvedValue({ id: 'runtime-set-1', engineId: 'engine-1' }) };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', runtimeAccessScope: 'resource_aware' }) };
        if (entity === RbacRolePermission) return { find: rolePermissionFind };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(duplicateQb), insert: insertAssignment, find: vi.fn().mockResolvedValue([]) };
        if (entity === AuditLog) return { insert: vi.fn().mockResolvedValue(undefined) };
        throw new Error('Unexpected repository');
      },
    });

    await permissionService.assignRole({
      principalType: 'group', principalId: 'group-1', roleId: 'custom.engine.viewer',
      scopeType: 'engine_runtime_resource_set', scopeId: 'runtime-set-1', createdById: 'admin-1',
      source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn',
      sourceHash: 'bundle-hash', lastAppliedAt: 123, driftStatus: 'in_sync',
    });

    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: 'engine_runtime_resource_set', scopeId: 'runtime-set-1',
      source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn',
      sourceHash: 'bundle-hash', lastAppliedAt: 123, driftStatus: 'in_sync',
    }));
    const insertedAssignment = insertAssignment.mock.calls[0][0];
    expect(insertedAssignment).not.toHaveProperty('userId');
    expect(insertedAssignment).not.toHaveProperty('resourceType');
    expect(insertedAssignment).not.toHaveProperty('resourceId');
    expect(insertedAssignment).not.toHaveProperty('sourceMappingId');
  });

  it('warns when an Engine Set grant already provides the runtime permission', async () => {
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
        if (entity === EngineSetMaterialization) return { find: vi.fn().mockResolvedValue([{ engineSetId: 'engine-set-1', engineId: 'engine-1' }]) };
        if (entity === RbacRolePermission) return { find: rolePermissionFind };
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(duplicateQb), insert: insertAssignment, find: vi.fn().mockResolvedValue([{ roleId: 'system.engine.operator', scopeType: 'engine_set', scopeId: 'engine-set-1', source: 'manual', expiresAt: null }]) };
        if (entity === AuditLog) return { insert: vi.fn().mockResolvedValue(undefined) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await permissionService.assignRole({
      principalType: 'group', principalId: 'group-1', roleId: 'custom.engine.viewer',
      scopeType: 'engine_runtime_resource', scopeId: 'runtime-1', createdById: 'admin-1',
    });

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
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
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
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
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
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR,
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
      principalType: 'api_client',
      principalId: 'api-client-1',
      roleId: SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR,
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
      principalType: 'group',
      principalId: 'group-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
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
      principalType: 'service_account',
      principalId: 'service-account-1',
      roleId: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
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

  it('keeps config-managed custom roles read-only outside config apply', async () => {
    const roleRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'role-config',
        kind: 'custom',
        isEditable: true,
        source: 'config',
        sourceRef: 'config_bundle:acme.authz',
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return roleRepo;
        throw new Error('Unexpected repository');
      },
    });

    await expect(permissionService.updateCustomRole('role-config', { name: 'Changed' }))
      .rejects.toThrow('Config-managed roles must be updated through their configuration bundle');
  });

  it('allows config-warning custom role edits and marks the role as drifted', async () => {
    const roleUpdate = vi.fn();
    const auditInsert = vi.fn();
    const role = {
      id: 'role-config-warning', tenantId: 'tenant-a', name: 'Warning role', scope: 'engine', kind: 'custom', isEditable: true,
      source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn', driftStatus: 'in_sync', isArchived: false,
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { update: roleUpdate };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: vi.fn().mockResolvedValue(role) };
        throw new Error('Unexpected repository');
      },
      transaction: async (callback: any) => callback(manager),
    });

    await permissionService.updateCustomRole('role-config-warning', {
      tenantId: 'tenant-a', name: 'Locally changed', updatedById: 'admin-1',
    });

    expect(roleUpdate).toHaveBeenCalledWith('role-config-warning', expect.objectContaining({
      name: 'Locally changed', driftStatus: 'drifted',
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ details: expect.stringContaining('drifted') }));
  });

  it('updates custom role assignability without allowing archived roles to become assignable', async () => {
    const roleUpdate = vi.fn();
    const auditInsert = vi.fn();
    const role = {
      id: 'role-assignable', tenantId: null, name: 'Operators', scope: 'engine', kind: 'custom', isEditable: true,
      source: 'manual', ownershipMode: 'manual', isArchived: false, isAssignable: true,
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { update: roleUpdate };
        if (entity === AuditLog) return { insert: auditInsert };
        throw new Error('Unexpected repository');
      },
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRole) return { findOne: vi.fn().mockResolvedValue(role) };
        throw new Error('Unexpected repository');
      },
      transaction: async (callback: any) => callback(manager),
    });

    await permissionService.updateCustomRole('role-assignable', { isAssignable: false, updatedById: 'admin-1' });
    expect(roleUpdate).toHaveBeenCalledWith('role-assignable', expect.objectContaining({ isAssignable: false }));

    await permissionService.updateCustomRole('role-assignable', { isArchived: true, isAssignable: true, updatedById: 'admin-1' });
    expect(roleUpdate).toHaveBeenLastCalledWith('role-assignable', expect.objectContaining({ isArchived: true, isAssignable: false }));
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

  it('tombstones config-warning assignments before removing them', async () => {
    const assignmentRepo = { findOne: vi.fn().mockResolvedValue({
      id: 'assignment-warning', tenantId: 'tenant-a', assignmentKey: 'tenant-a:group-1:role-1:engine:engine-1:config',
      source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn', principalType: 'group', principalId: 'group-1', roleId: 'role-1', scopeType: 'engine', scopeId: 'engine-1',
    }), delete: vi.fn() };
    const overrideRepo = { upsert: vi.fn() };
    const auditRepo = { insert: vi.fn() };
    const repositories = (entity: unknown) => {
      if (entity === RbacRoleAssignment) return assignmentRepo;
      if (entity === ConfigRoleAssignmentOverride) return overrideRepo;
      if (entity === AuditLog) return auditRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: repositories, transaction: async (callback: any) => callback({ getRepository: repositories }) });

    await permissionService.removeRoleAssignment('assignment-warning', 'admin-1');

    expect(overrideRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({ assignmentKey: 'tenant-a:group-1:role-1:engine:engine-1:config', sourceRef: 'config_bundle:acme.authz', removedAssignmentId: 'assignment-warning' }), { conflictPaths: ['assignmentKey', 'sourceRef'] });
    expect(assignmentRepo.delete).toHaveBeenCalledWith({ id: 'assignment-warning' });
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ details: expect.stringContaining('configOverride') }));
  });

  it('updates and removes resolved assignments through a supplied transaction store', async () => {
    const assignmentRepo = { update: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
    const store = { getRepository: (entity: unknown) => {
      if (entity === RbacRoleAssignment) return assignmentRepo;
      throw new Error('Unexpected repository');
    } };

    await permissionService.updateResolvedRoleAssignment(store as any, 'assignment-1', {
      expiresAt: 123, ownershipMode: 'config_warn', sourceHash: 'hash-1', lastAppliedAt: 456,
      driftStatus: 'in_sync', lastSeenAt: 789,
    });
    await permissionService.deleteResolvedRoleAssignments(store as any, ['assignment-1', 'assignment-2']);

    expect(assignmentRepo.update).toHaveBeenCalledWith({ id: 'assignment-1' }, expect.objectContaining({
      expiresAt: 123, ownershipMode: 'config_warn', sourceHash: 'hash-1', lastAppliedAt: 456,
      driftStatus: 'in_sync', lastSeenAt: 789, updatedAt: expect.any(Number),
    }));
    expect(assignmentRepo.delete).toHaveBeenCalledWith(['assignment-1', 'assignment-2']);
  });

  it('lists user assignments through canonical principals', async () => {
    const assignmentQb = {
      orderBy: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'assignment-sso-1', tenantId: 'tenant-a', principalType: 'user', principalId: 'user-1',
        roleId: 'system.engine.operator', scopeType: 'engine', scopeId: 'engine-1', source: 'sso',
        sourceRef: 'legacy_sso:provider-1:mapping:mapping-1',
        ownershipMode: 'manual', sourceHash: null, lastAppliedAt: null, driftStatus: null,
        expiresAt: null, lastSeenAt: null, createdById: null, createdAt: 10, updatedAt: 11,
      }]),
    };
    const assignmentRepo = { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRoleAssignment) return assignmentRepo;
        if (entity === RbacRole) return { find: vi.fn().mockResolvedValue([{ id: 'system.engine.operator', key: 'system.engine.operator', name: 'Operator', scope: 'engine' }]) };
        throw new Error('Unexpected repository');
      },
    });

    const assignments = await permissionService.listRoleAssignments({ userId: 'user-1', tenantId: 'tenant-a' });

    expect(assignmentQb.andWhere).toHaveBeenCalledWith(
      '(assignment.principalType = :userPrincipalType AND assignment.principalId = :userId)',
      { userPrincipalType: 'user', userId: 'user-1' }
    );
    expect(assignments).toEqual([expect.objectContaining({
      userId: 'user-1',
      sourceRef: 'legacy_sso:provider-1:mapping:mapping-1',
    })]);
  });

  it('uses canonical scope fields for legacy resource filters', async () => {
    const assignmentQb = {
      orderBy: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === RbacRoleAssignment) return { createQueryBuilder: vi.fn().mockReturnValue(assignmentQb) };
        if (entity === RbacRole) return { find: vi.fn().mockResolvedValue([]) };
        throw new Error('Unexpected repository');
      },
    });

    await permissionService.listRoleAssignments({ resourceType: 'engine', resourceId: 'engine-1' });

    expect(assignmentQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('assignment.scopeType = :resourceType'),
      { resourceType: 'engine' }
    );
    expect(assignmentQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('assignment.scopeId = :resourceId'),
      { resourceId: 'engine-1' }
    );
  });

  it('syncs legacy project and engine memberships into canonical source=legacy role assignments', async () => {
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
          principalType: 'user',
          principalId: 'owner-1',
          roleId: SYSTEM_ROLE_IDS.PROJECT_OWNER,
          scopeType: 'project',
          scopeId: 'project-1',
          source: 'legacy',
          sourceRef: 'project:project-1:owner',
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
    const syncedRows = assignmentUpsert.mock.calls[0][0];
    for (const row of syncedRows) {
      expect(row).not.toHaveProperty('userId');
      expect(row).not.toHaveProperty('resourceType');
      expect(row).not.toHaveProperty('resourceId');
      expect(row).not.toHaveProperty('sourceMappingId');
    }
  });

  it('uses canonical scope fields when reconciling a scoped legacy synchronization', async () => {
    const assignmentRepo = {
      find: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const projectRepo = { find: vi.fn().mockResolvedValue([]) };
    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === Project) return projectRepo;
        if (entity === ProjectMember || entity === ProjectMemberRole) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === RbacRoleAssignment) return assignmentRepo;
        throw new Error('Unexpected repository');
      },
    } as any;

    await permissionService.syncLegacyRoleAssignments({ projectIds: ['project-1'] }, dataSource);

    expect(assignmentRepo.find).toHaveBeenCalledWith({
      where: [{ source: 'legacy', scopeType: 'project', scopeId: expect.anything() }],
    });
    const where = assignmentRepo.find.mock.calls[0][0].where[0];
    expect(where).not.toHaveProperty('resourceType');
    expect(where).not.toHaveProperty('resourceId');
  });
});
