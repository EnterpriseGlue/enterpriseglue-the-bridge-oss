import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzAuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzAuditLog.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { engineSetService } from '@enterpriseglue/shared/services/platform-admin/EngineSetService.js';
import { PlatformPermissions, ProjectPermissions, EnginePermissions, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/PolicyService.js';
import { runtimeResourceSetService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceSetService.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { cleanupEngines, cleanupSeededData, seedEngine, seedProject, seedUser } from '../utils/seed.js';

const prefix = `custom_role_scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const roleKeyPrefix = `custom.scope${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const tenantId = `tenant-${prefix}`;

let skip = false;
let adminUserId = '';
let directUserId = '';
let groupUserId = '';
let groupId = '';
let projectId = '';
let siblingProjectId = '';
let directEngineId = '';
let engineSetEngineId = '';
let runtimeEngineId = '';
let runtimeResourceId = '';
let runtimeSetResourceId = '';
let siblingRuntimeResourceId = '';
let engineSetId = '';
let runtimeResourceSetId = '';
let roleIds: string[] = [];

describe('custom role scope matrix (database)', () => {
  beforeAll(async () => {
    const dataSource = await getDataSource();
    const queryRunner = dataSource.createQueryRunner();
    try {
      skip = !await queryRunner.hasTable('engine_sets') ||
        !await queryRunner.hasTable('runtime_resource_sets') ||
        !await queryRunner.hasTable('authz_groups') ||
        !await queryRunner.hasTable('role_assignments');
    } finally {
      await queryRunner.release();
    }
    if (skip) return;

    await permissionService.seedRbacFoundation(dataSource);
    const [admin, directUser, groupUser] = await Promise.all([
      seedUser(`${prefix}-admin`),
      seedUser(`${prefix}-direct`),
      seedUser(`${prefix}-group`),
    ]);
    adminUserId = admin.id;
    directUserId = directUser.id;
    groupUserId = groupUser.id;

    const [project, siblingProject, directEngine, engineSetEngine, runtimeEngine] = await Promise.all([
      seedProject(adminUserId, `${prefix}-project`),
      seedProject(adminUserId, `${prefix}-project-sibling`),
      seedEngine(adminUserId, `http://${prefix}-direct.invalid`, `${prefix}-direct-engine`),
      seedEngine(adminUserId, `http://${prefix}-set.invalid`, `${prefix}-set-engine`),
      seedEngine(adminUserId, `http://${prefix}-runtime.invalid`, `${prefix}-runtime-engine`),
    ]);
    projectId = project.id;
    siblingProjectId = siblingProject.id;
    directEngineId = directEngine.id;
    engineSetEngineId = engineSetEngine.id;
    runtimeEngineId = runtimeEngine.id;
    await Promise.all([
      dataSource.getRepository(Engine).update({ id: directEngineId }, { tenantId }),
      dataSource.getRepository(Engine).update({ id: engineSetEngineId }, { tenantId }),
      dataSource.getRepository(Engine).update({ id: runtimeEngineId }, { tenantId, runtimeAccessScope: 'resource_aware' }),
      dataSource.getRepository(Project).update({ id: projectId }, { tenantId }),
      dataSource.getRepository(Project).update({ id: siblingProjectId }, { tenantId }),
    ]);

    const group = await authzGroupService.createGroup({ tenantId, key: `${prefix}-operators`, name: `${prefix} operators`, createdById: adminUserId });
    groupId = group.id;
    await authzGroupService.addMembership({ tenantId, groupId, userId: groupUserId, createdById: adminUserId });

    const [platformRole, projectRole, engineRole] = await Promise.all([
      permissionService.createCustomRole({ key: `${roleKeyPrefix}.platform`, name: `${prefix} platform`, scope: 'platform', permissionIds: [PlatformPermissions.DASHBOARD_VIEW], createdById: adminUserId }),
      permissionService.createCustomRole({ key: `${roleKeyPrefix}.project`, name: `${prefix} project`, scope: 'project', permissionIds: [ProjectPermissions.DEPLOY], createdById: adminUserId }),
      permissionService.createCustomRole({ key: `${roleKeyPrefix}.engine`, name: `${prefix} engine`, scope: 'engine', permissionIds: [EnginePermissions.INSTANCE_VIEW], createdById: adminUserId }),
    ]);
    roleIds = [platformRole.id, projectRole.id, engineRole.id];

    const engineSet = await engineSetService.createEngineSet({
      tenantId,
      key: `${prefix}-engine-set`,
      name: `${prefix} engine set`,
      selector: { mode: 'engine_ids', engineIds: [engineSetEngineId] },
      createdById: adminUserId,
    });
    engineSetId = engineSet.id;

    const now = Date.now();
    const runtimeResources = [
      { id: generateId(), resourceKey: `${prefix}-direct` },
      { id: generateId(), resourceKey: `${prefix}-set` },
      { id: generateId(), resourceKey: `${prefix}-sibling` },
    ];
    [runtimeResourceId, runtimeSetResourceId, siblingRuntimeResourceId] = runtimeResources.map((resource) => resource.id);
    await dataSource.getRepository(RuntimeResource).insert(runtimeResources.map((resource) => ({
      ...resource,
      tenantId,
      engineId: runtimeEngineId,
      resourceKind: 'process_definition',
      runtimeTenantId: '',
      engineResourceId: null,
      deploymentId: null,
      projectId: null,
      fileId: null,
      version: 1,
      labelsJson: '{}',
      lineageJson: '{}',
      source: 'test',
      sourceRef: prefix,
      observedAt: now,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })));
    const runtimeSet = await runtimeResourceSetService.create({
      tenantId,
      key: `${prefix}-runtime-set`,
      name: `${prefix} runtime set`,
      engineId: runtimeEngineId,
      resourceKind: 'process_definition',
      selector: { mode: 'keys', keys: [runtimeResources[1].resourceKey] },
      createdById: adminUserId,
    });
    runtimeResourceSetId = runtimeSet.id;
    await dataSource.getRepository(RuntimeResourceSetMaterialization).insert({
      id: generateId(), tenantId, runtimeResourceSetId, runtimeResourceId: runtimeSetResourceId,
      selectorFingerprint: 'test', matchedByJson: '{}', lineageJson: '{}', lastSeenAt: now, createdAt: now, updatedAt: now,
    });

    await Promise.all([
      permissionService.assignRole({ tenantId, userId: directUserId, roleId: platformRole.id, resourceType: 'platform', createdById: adminUserId }),
      permissionService.assignRole({ tenantId, userId: directUserId, roleId: projectRole.id, resourceType: 'project', resourceId: projectId, createdById: adminUserId }),
      permissionService.assignRole({ tenantId, userId: directUserId, roleId: engineRole.id, resourceType: 'engine', resourceId: directEngineId, createdById: adminUserId }),
      permissionService.assignRole({ tenantId, principalType: 'group', principalId: groupId, roleId: engineRole.id, resourceType: 'engine_set', resourceId: engineSetId, createdById: adminUserId }),
      permissionService.assignRole({ tenantId, userId: groupUserId, roleId: engineRole.id, resourceType: 'engine_runtime_resource', resourceId: runtimeResourceId, createdById: adminUserId }),
      permissionService.assignRole({ tenantId, principalType: 'group', principalId: groupId, roleId: engineRole.id, resourceType: 'engine_runtime_resource_set', resourceId: runtimeResourceSetId, createdById: adminUserId }),
    ]);
  });

  afterAll(async () => {
    if (skip) return;
    const dataSource = await getDataSource();
    await dataSource.getRepository(RbacRoleAssignment).delete({ roleId: roleIds as any });
    await dataSource.getRepository(RuntimeResourceSetMaterialization).delete({ runtimeResourceSetId });
    await dataSource.getRepository(RuntimeResourceSet).delete({ id: runtimeResourceSetId });
    await dataSource.getRepository(RuntimeResource).delete({ id: [runtimeResourceId, runtimeSetResourceId, siblingRuntimeResourceId] as any });
    await dataSource.getRepository(EngineSetMaterialization).delete({ engineSetId });
    await dataSource.getRepository(EngineSet).delete({ id: engineSetId });
    await dataSource.getRepository(AuthzGroupMembership).delete({ groupId });
    await dataSource.getRepository(AuthzGroup).delete({ id: groupId });
    await dataSource.getRepository(AuthzAuditLog).delete({ userId: [directUserId, groupUserId] as any });
    await dataSource.getRepository(RbacRolePermission).delete({ roleId: roleIds as any });
    await dataSource.getRepository(RbacRole).delete({ id: roleIds as any });
    await cleanupEngines([directEngineId, engineSetEngineId, runtimeEngineId]);
    await cleanupSeededData(prefix, [projectId, siblingProjectId], [adminUserId, directUserId, groupUserId]);
  });

  it('resolves every custom-role scope for users and groups without widening to sibling resources', async () => {
    if (skip) return;
    const check = (permission: string, userId: string, resourceType: any, resourceId?: string) =>
      permissionService.hasPermission(permission as any, { userId, tenantId, resourceType, resourceId });

    await expect(check(PlatformPermissions.DASHBOARD_VIEW, directUserId, 'platform')).resolves.toBe(true);
    await expect(check(ProjectPermissions.DEPLOY, directUserId, 'project', projectId)).resolves.toBe(true);
    await expect(check(ProjectPermissions.DEPLOY, directUserId, 'project', siblingProjectId)).resolves.toBe(false);
    await expect(check(EnginePermissions.INSTANCE_VIEW, directUserId, 'engine', directEngineId)).resolves.toBe(true);
    await expect(check(EnginePermissions.INSTANCE_VIEW, directUserId, 'engine', engineSetEngineId)).resolves.toBe(false);

    const engineSetDecision = await permissionService.evaluatePermission(EnginePermissions.INSTANCE_VIEW, {
      userId: groupUserId, tenantId, resourceType: 'engine', resourceId: engineSetEngineId,
    });
    expect(engineSetDecision.allowed).toBe(true);
    expect(engineSetDecision.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ principalType: 'group', principalId: groupId, scopeType: 'engine_set', scopeId: engineSetId }),
    ]));
    const dataSource = await getDataSource();
    const materialization = await dataSource.getRepository(EngineSetMaterialization).findOneBy({ engineSetId, engineId: engineSetEngineId });
    expect(materialization).not.toBeNull();
    await dataSource.getRepository(EngineSetMaterialization).delete({ id: materialization!.id });
    await expect(check(EnginePermissions.INSTANCE_VIEW, groupUserId, 'engine', engineSetEngineId)).resolves.toBe(false);
    await dataSource.getRepository(EngineSetMaterialization).insert(materialization!);
    await expect(check(EnginePermissions.INSTANCE_VIEW, groupUserId, 'engine', engineSetEngineId)).resolves.toBe(true);

    await expect(check(EnginePermissions.INSTANCE_VIEW, groupUserId, 'engine_runtime_resource', runtimeResourceId)).resolves.toBe(true);
    const runtimeSetDecision = await permissionService.evaluatePermission(EnginePermissions.INSTANCE_VIEW, {
      userId: groupUserId, tenantId, resourceType: 'engine_runtime_resource', resourceId: runtimeSetResourceId,
    });
    expect(runtimeSetDecision.allowed).toBe(true);
    expect(runtimeSetDecision.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ principalType: 'group', principalId: groupId, scopeType: 'engine_runtime_resource_set', scopeId: runtimeResourceSetId }),
    ]));
    await expect(check(EnginePermissions.INSTANCE_VIEW, groupUserId, 'engine_runtime_resource', siblingRuntimeResourceId)).resolves.toBe(false);
  });

  it('records scoped assignment lifecycle audit entries without secret or cross-tenant leakage', async () => {
    if (skip) return;
    const entries = await (await getDataSource()).getRepository(AuditLog).find({
      where: { userId: adminUserId, action: 'authz.role_assignment.create' },
      order: { createdAt: 'ASC' },
    });
    const details = entries.map((entry) => JSON.parse(entry.details || '{}'));
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId, scopeType: 'platform', principalId: directUserId }),
      expect.objectContaining({ tenantId, scopeType: 'project', scopeId: projectId, principalId: directUserId }),
      expect.objectContaining({ tenantId, scopeType: 'engine', scopeId: directEngineId, principalId: directUserId }),
      expect.objectContaining({ tenantId, scopeType: 'engine_set', scopeId: engineSetId, principalType: 'group', principalId: groupId }),
      expect.objectContaining({ tenantId, scopeType: 'engine_runtime_resource', scopeId: runtimeResourceId, principalId: groupUserId }),
      expect.objectContaining({ tenantId, scopeType: 'engine_runtime_resource_set', scopeId: runtimeResourceSetId, principalType: 'group', principalId: groupId }),
    ]));
    for (const entry of entries) {
      expect(entry.tenantId).toBe(tenantId);
      expect(entry.details || '').not.toMatch(/token|secret|password|tenant-(?!custom_role_scope)/i);
    }
  });

  it('audits assignment expiry, removal, and a denied decision without widening tenant visibility', async () => {
    if (skip) return;
    const now = Date.now();
    const expiring = await permissionService.assignRole({
      tenantId, userId: directUserId, roleId: roleIds[1], resourceType: 'project', resourceId: siblingProjectId,
      expiresAt: now + 1_000, createdById: adminUserId,
    });
    await expect(permissionService.hasPermission(ProjectPermissions.DEPLOY, {
      userId: directUserId, tenantId, resourceType: 'project', resourceId: siblingProjectId,
    })).resolves.toBe(true);
    await expect(permissionService.cleanupExpiredRoleAssignments({ now: now + 1_001, assignmentIds: [expiring.id] })).resolves.toBe(1);
    await expect(permissionService.hasPermission(ProjectPermissions.DEPLOY, {
      userId: directUserId, tenantId, resourceType: 'project', resourceId: siblingProjectId,
    })).resolves.toBe(false);

    const removable = await permissionService.assignRole({
      tenantId, userId: directUserId, roleId: roleIds[1], resourceType: 'project', resourceId: siblingProjectId,
      createdById: adminUserId,
    });
    await permissionService.removeRoleAssignment(removable.id, adminUserId);
    const denied = await policyService.evaluateAndLog(ProjectPermissions.DEPLOY, {
      userId: directUserId, tenantId, resourceType: 'project', resourceId: siblingProjectId,
    });
    expect(denied).toEqual({ decision: 'deny', reason: 'no-permission' });

    const dataSource = await getDataSource();
    const lifecycleEntries = (await dataSource.getRepository(AuditLog).find({
      where: [
        { action: 'authz.role_assignment.create' },
        { action: 'authz.role_assignment.expire' },
        { action: 'authz.role_assignment.delete' },
      ],
      order: { createdAt: 'ASC' },
    })).filter((entry) => entry.resourceId === expiring.id || entry.resourceId === removable.id);
    expect(lifecycleEntries.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      'authz.role_assignment.create', 'authz.role_assignment.expire', 'authz.role_assignment.delete',
    ]));
    for (const entry of lifecycleEntries) {
      expect(entry.tenantId).toBe(tenantId);
      expect(entry.details || '').not.toMatch(/token|secret|password|tenant-(?!custom_role_scope)/i);
    }
    const decisionAudit = await dataSource.getRepository(AuthzAuditLog).findOne({
      where: { userId: directUserId, action: ProjectPermissions.DEPLOY, resourceId: siblingProjectId, decision: 'deny' },
      order: { timestamp: 'DESC' },
    });
    expect(decisionAudit).toMatchObject({ tenantId, reason: 'no-permission' });
    expect(decisionAudit?.context).not.toMatch(/token|secret|password|tenant-(?!custom_role_scope)/i);
  });
});
