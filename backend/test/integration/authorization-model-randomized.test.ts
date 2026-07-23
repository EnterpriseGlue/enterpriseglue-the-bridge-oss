import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { In } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { engineSetService } from '@enterpriseglue/shared/services/platform-admin/EngineSetService.js';
import { EnginePermissions, PlatformPermissions, ProjectPermissions, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { runtimeResourceSetService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceSetService.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { cleanupEngines, cleanupSeededData, seedEngine, seedProject, seedUser } from '../utils/seed.js';

/**
 * A deliberately small, independent RBAC model. It knows only the test
 * fixture's graph and scope rules; it does not call production helpers. Each
 * generated database state is compared against every fixture decision.
 */
const prefix = `authz_model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const tenantId = `tenant-${prefix}`;
const roleKeyPrefix = `custom.model${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const modelGroupKey = `${prefix}-group`;
const scenarios = 24;

type Scope = 'platform' | 'project' | 'engine' | 'engine_set' | 'engine_runtime_resource' | 'engine_runtime_resource_set';
type Principal = 'direct' | 'group';
type ModelRule = { scope: Scope; principal: Principal; targetId: string | null; expiresAt: number | null };
type ModelRequest = { permission: string; principal: Principal; resourceType: 'platform' | 'project' | 'engine' | 'engine_runtime_resource'; resourceId?: string };

let skip = false;
let adminUserId = '';
let directUserId = '';
let groupUserId = '';
let groupId = '';
let projectAId = '';
let projectBId = '';
let engineAId = '';
let engineBId = '';
let runtimeAId = '';
let runtimeBId = '';
let runtimeCId = '';
let engineSetId = '';
let runtimeSetId = '';
let roleIds: string[] = [];
let roleByScope: Record<'platform' | 'project' | 'engine', string> = { platform: '', project: '', engine: '' };

function nextRandom(seed: number): number {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
}

function roleFor(scope: Scope): string {
  return roleByScope[scope === 'platform' ? 'platform' : scope === 'project' ? 'project' : 'engine'];
}

function permissionFor(scope: Scope): string {
  return scope === 'platform' ? PlatformPermissions.DASHBOARD_VIEW : scope === 'project' ? ProjectPermissions.DEPLOY : EnginePermissions.INSTANCE_VIEW;
}

function expectedDecision(rules: ModelRule[], request: ModelRequest, now: number): boolean {
  return rules.some((rule) => {
    if (rule.principal !== request.principal || (rule.expiresAt !== null && rule.expiresAt <= now)) return false;
    if (permissionFor(rule.scope) !== request.permission) return false;
    if (rule.scope === 'platform') return request.resourceType === 'platform';
    if (rule.scope === 'project') return request.resourceType === 'project' && request.resourceId === rule.targetId;
    if (rule.scope === 'engine') {
      return (request.resourceType === 'engine' && request.resourceId === rule.targetId)
        || (request.resourceType === 'engine_runtime_resource' && runtimeEngineId(request.resourceId!) === rule.targetId);
    }
    if (rule.scope === 'engine_set') {
      return (request.resourceType === 'engine' && request.resourceId === engineBId)
        || (request.resourceType === 'engine_runtime_resource' && runtimeEngineId(request.resourceId!) === engineBId);
    }
    if (rule.scope === 'engine_runtime_resource') return request.resourceType === 'engine_runtime_resource' && request.resourceId === rule.targetId;
    return request.resourceType === 'engine_runtime_resource' && request.resourceId === runtimeBId;
  });
}

function runtimeEngineId(runtimeResourceId: string): string {
  if (runtimeResourceId === runtimeAId) return engineAId;
  return engineBId;
}

function generatedRules(iteration: number, now: number): ModelRule[] {
  const candidates: Array<Omit<ModelRule, 'expiresAt'>> = [
    { scope: 'platform', principal: 'direct', targetId: null },
    { scope: 'platform', principal: 'group', targetId: null },
    { scope: 'project', principal: 'direct', targetId: projectAId },
    { scope: 'project', principal: 'group', targetId: projectBId },
    { scope: 'engine', principal: 'direct', targetId: engineAId },
    { scope: 'engine', principal: 'group', targetId: engineBId },
    { scope: 'engine_set', principal: 'direct', targetId: engineSetId },
    { scope: 'engine_set', principal: 'group', targetId: engineSetId },
    { scope: 'engine_runtime_resource', principal: 'direct', targetId: runtimeAId },
    { scope: 'engine_runtime_resource', principal: 'group', targetId: runtimeCId },
    { scope: 'engine_runtime_resource_set', principal: 'direct', targetId: runtimeSetId },
    { scope: 'engine_runtime_resource_set', principal: 'group', targetId: runtimeSetId },
  ];
  let random = (iteration + 1) * 0x9e3779b9;
  return candidates.flatMap((candidate) => {
    random = nextRandom(random);
    // Omitted, active, and expired rules all occur in every deterministic run.
    const state = random % 3;
    if (state === 0) return [];
    return [{ ...candidate, expiresAt: state === 1 ? null : now - 1_000 }];
  });
}

function requests(): ModelRequest[] {
  return [
    ...(['direct', 'group'] as Principal[]).map((principal) => ({ permission: PlatformPermissions.DASHBOARD_VIEW, principal, resourceType: 'platform' as const })),
    ...(['direct', 'group'] as Principal[]).flatMap((principal) => [projectAId, projectBId].map((resourceId) => ({ permission: ProjectPermissions.DEPLOY, principal, resourceType: 'project' as const, resourceId }))),
    ...(['direct', 'group'] as Principal[]).flatMap((principal) => [engineAId, engineBId].map((resourceId) => ({ permission: EnginePermissions.INSTANCE_VIEW, principal, resourceType: 'engine' as const, resourceId }))),
    ...(['direct', 'group'] as Principal[]).flatMap((principal) => [runtimeAId, runtimeBId, runtimeCId].map((resourceId) => ({ permission: EnginePermissions.INSTANCE_VIEW, principal, resourceType: 'engine_runtime_resource' as const, resourceId }))),
  ];
}

describe('randomized authorization model (database)', () => {
  beforeAll(async () => {
    const dataSource = await getDataSource();
    const queryRunner = dataSource.createQueryRunner();
    try {
      skip = !await queryRunner.hasTable('role_assignments') || !await queryRunner.hasTable('runtime_resource_sets');
    } finally {
      await queryRunner.release();
    }
    if (skip) return;

    await permissionService.seedRbacFoundation(dataSource);
    const [admin, direct, grouped] = await Promise.all([seedUser(`${prefix}-admin`), seedUser(`${prefix}-direct`), seedUser(`${prefix}-grouped`)]);
    adminUserId = admin.id;
    directUserId = direct.id;
    groupUserId = grouped.id;
    const [projectA, projectB, engineA, engineB] = await Promise.all([
      seedProject(adminUserId, `${prefix}-project-a`), seedProject(adminUserId, `${prefix}-project-b`),
      seedEngine(adminUserId, `http://${prefix}-engine-a.invalid`, `${prefix}-engine-a`), seedEngine(adminUserId, `http://${prefix}-engine-b.invalid`, `${prefix}-engine-b`),
    ]);
    projectAId = projectA.id;
    projectBId = projectB.id;
    engineAId = engineA.id;
    engineBId = engineB.id;
    await Promise.all([
      dataSource.getRepository(Project).update({ id: projectAId }, { tenantId }), dataSource.getRepository(Project).update({ id: projectBId }, { tenantId }),
      dataSource.getRepository(Engine).update({ id: engineAId }, { tenantId, runtimeAccessScope: 'resource_aware' }), dataSource.getRepository(Engine).update({ id: engineBId }, { tenantId, runtimeAccessScope: 'resource_aware' }),
    ]);
    const group = await authzGroupService.createGroup({ tenantId, key: modelGroupKey, name: `${prefix} group`, createdById: adminUserId });
    groupId = group.id;
    await authzGroupService.addMembership({ tenantId, groupId, userId: groupUserId, createdById: adminUserId });
    const engineSet = await engineSetService.createEngineSet({ tenantId, key: `${prefix}-engine-set`, name: `${prefix} engine set`, selector: { mode: 'engine_ids', engineIds: [engineBId] }, createdById: adminUserId });
    engineSetId = engineSet.id;
    const now = Date.now();
    const resources = [
      { id: generateId(), engineId: engineAId, resourceKey: `${prefix}-runtime-a` },
      { id: generateId(), engineId: engineBId, resourceKey: `${prefix}-runtime-b` },
      { id: generateId(), engineId: engineBId, resourceKey: `${prefix}-runtime-c` },
    ];
    [runtimeAId, runtimeBId, runtimeCId] = resources.map((resource) => resource.id);
    await dataSource.getRepository(RuntimeResource).insert(resources.map((resource) => ({
      ...resource,
      tenantId,
      tenantResolutionStatus: 'resolved',
      tenantMappingId: null,
      tenantMappingVersion: 0,
      tenantResolutionDetailsJson: '{"code":"dedicated_engine_tenant"}',
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
    const runtimeSet = await runtimeResourceSetService.create({ tenantId, key: `${prefix}-runtime-set`, name: `${prefix} runtime set`, engineId: engineBId, resourceKind: 'process_definition', selector: { mode: 'keys', keys: [resources[1].resourceKey] }, createdById: adminUserId });
    runtimeSetId = runtimeSet.id;
    const existingRuntimeMaterialization = await dataSource.getRepository(RuntimeResourceSetMaterialization).findOneBy({ runtimeResourceSetId: runtimeSetId, runtimeResourceId: runtimeBId });
    if (!existingRuntimeMaterialization) {
      await dataSource.getRepository(RuntimeResourceSetMaterialization).insert({ id: generateId(), tenantId, runtimeResourceSetId: runtimeSetId, runtimeResourceId: runtimeBId, selectorFingerprint: 'model', matchedByJson: '{}', lineageJson: '{}', lastSeenAt: now, createdAt: now, updatedAt: now });
    }
    const [platformRole, projectRole, engineRole] = await Promise.all([
      permissionService.createCustomRole({ key: `${roleKeyPrefix}.platform`, name: `${prefix} platform`, scope: 'platform', permissionIds: [PlatformPermissions.DASHBOARD_VIEW], createdById: adminUserId }),
      permissionService.createCustomRole({ key: `${roleKeyPrefix}.project`, name: `${prefix} project`, scope: 'project', permissionIds: [ProjectPermissions.DEPLOY], createdById: adminUserId }),
      permissionService.createCustomRole({ key: `${roleKeyPrefix}.engine`, name: `${prefix} engine`, scope: 'engine', permissionIds: [EnginePermissions.INSTANCE_VIEW], createdById: adminUserId }),
    ]);
    roleIds = [platformRole.id, projectRole.id, engineRole.id];
    roleByScope = { platform: platformRole.id, project: projectRole.id, engine: engineRole.id };
  });

  afterAll(async () => {
    if (skip) return;
    const dataSource = await getDataSource();
    await dataSource.getRepository(RbacRoleAssignment).delete({ roleId: roleIds as any });
    await dataSource.getRepository(RuntimeResourceSetMaterialization).delete({ runtimeResourceSetId: runtimeSetId });
    await dataSource.getRepository(RuntimeResourceSet).delete({ id: runtimeSetId });
    await dataSource.getRepository(RuntimeResource).delete({ id: [runtimeAId, runtimeBId, runtimeCId] as any });
    await dataSource.getRepository(EngineSetMaterialization).delete({ engineSetId });
    await dataSource.getRepository(EngineSet).delete({ id: engineSetId });
    await dataSource.getRepository(RbacRolePermission).delete({ roleId: roleIds as any });
    await dataSource.getRepository(RbacRole).delete({ id: roleIds as any });
    await cleanupEngines([engineAId, engineBId]);
    await cleanupSeededData(prefix, [projectAId, projectBId], [adminUserId, directUserId, groupUserId]);
  });

  it(`matches an independent scope model across ${scenarios} generated authorization states`, async () => {
    if (skip) return;
    const dataSource = await getDataSource();
    for (let iteration = 0; iteration < scenarios; iteration += 1) {
      const now = Date.now();
      const rules = generatedRules(iteration, now);
      const assignments = await Promise.all(rules.map((rule) => permissionService.assignRole({
        tenantId,
        principalType: rule.principal === 'group' ? 'group' : 'user',
        principalId: rule.principal === 'group' ? groupId : directUserId,
        roleId: roleFor(rule.scope),
        resourceType: rule.scope,
        resourceId: rule.targetId || undefined,
        expiresAt: rule.expiresAt,
        createdById: adminUserId,
      })));
      try {
        for (const request of requests()) {
          const actual = await permissionService.evaluatePermission(request.permission as any, {
            userId: request.principal === 'group' ? groupUserId : directUserId,
            tenantId,
            resourceType: request.resourceType,
            resourceId: request.resourceId,
          });
          expect(actual.allowed, `scenario ${iteration}: ${JSON.stringify({ rules, request, actual })}`).toBe(expectedDecision(rules, request, now));
        }
      } finally {
        await dataSource.getRepository(RbacRoleAssignment).delete({ id: In(assignments.map((assignment) => assignment.id)) });
      }
    }
  });
});
