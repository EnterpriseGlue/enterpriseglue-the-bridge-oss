import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { ConfigBundleRuntimeReconciliationTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleRuntimeReconciliationTask.js';
import { CamundaNativeGrantDraftService, camundaNativeGrantExternalEngineKey } from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantDraftService.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleRuntimeReconciliationTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js';
import { EnginePermissions, permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { cleanupEngines, cleanupSeededData, seedEngine, seedUser } from '../utils/seed.js';

const prefix = `camunda_native_grant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const tenantId = `tenant-${prefix}`;
const bundleKey = `migration.camunda-native-${prefix}`;
const sourceRef = `config_bundle:${bundleKey}`;
const groupKey = `group.camunda-${prefix}`;

let skip = false;
let adminUserId = '';
let allowedUserId = '';
let deniedUserId = '';
let engineId = '';
let importedRuntimeResourceId = '';
let decisionRuntimeResourceId = '';
let siblingRuntimeResourceId = '';
let importedGroupIds: string[] = [];
let importedRuntimeResourceSetIds: string[] = [];
let importedRoleId = '';
let forwardApplyRunId = '';
let rollbackApplyRunId = '';

function migrationBase() {
  return {
    bundle: {
      apiVersion: 'enterpriseglue.ai/v1alpha1',
      kind: 'EnterpriseGlueConfigBundle',
      metadata: { key: bundleKey, owner: 'camunda-native-grant-migration' },
      tenantKey: tenantId,
      mode: 'additive',
      settings: { engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative' },
      imports: ['./groups.json'],
    },
    files: { './groups.json': { groups: [] } },
  };
}

function rollbackFor(draft: { bundle: unknown }): { bundle: unknown; files: Record<string, unknown> } {
  const bundle = structuredClone(draft.bundle) as { imports: string[]; mode: string };
  bundle.mode = 'authoritative';
  return {
    bundle,
    files: {
      './groups.json': { groups: [] },
      './roles.json': { roles: [] },
      './runtime-resource-sets.json': { runtimeResourceSets: [] },
      './assignments.json': { assignments: [] },
    },
  };
}

describe('Camunda native-grant migration (database integration)', () => {
  beforeAll(async () => {
    const dataSource = await getDataSource();
    const queryRunner = dataSource.createQueryRunner();
    try {
      skip = !await queryRunner.hasTable('engines')
        || !await queryRunner.hasTable('runtime_resources')
        || !await queryRunner.hasTable('runtime_resource_sets')
        || !await queryRunner.hasTable('runtime_resource_set_materializations')
        || !await queryRunner.hasTable('authz_groups')
        || !await queryRunner.hasTable('role_assignments')
        || !await queryRunner.hasTable('config_bundle_apply_runs');
    } finally {
      await queryRunner.release();
    }
    if (skip) return;

    await permissionService.seedRbacFoundation(dataSource);
    const [admin, allowed, denied] = await Promise.all([
      seedUser(`${prefix}-admin`),
      seedUser(`${prefix}-allowed`),
      seedUser(`${prefix}-denied`),
    ]);
    adminUserId = admin.id;
    allowedUserId = allowed.id;
    deniedUserId = denied.id;
    const engine = await seedEngine(adminUserId, `http://${prefix}.invalid/engine-rest`, `${prefix} Camunda`, 'camunda7');
    engineId = engine.id;
    await dataSource.getRepository(Engine).update({ id: engineId }, {
      tenantId,
      tenancyMode: 'dedicated',
      tenantResolutionStatus: 'ready',
      runtimeAccessScope: 'resource_aware',
      lifecycleStatus: 'active',
      configKey: null,
    } as any);

    const now = Date.now();
    importedRuntimeResourceId = generateId();
    decisionRuntimeResourceId = generateId();
    siblingRuntimeResourceId = generateId();
    await dataSource.getRepository(RuntimeResource).insert([
      {
        id: importedRuntimeResourceId, tenantId, engineId, resourceKind: 'process_definition', resourceKey: 'invoice-process', runtimeTenantId: '',
        engineResourceId: null, deploymentId: null, projectId: null, fileId: null, version: 1, labelsJson: '{}', lineageJson: '{}',
        source: 'test', sourceRef: prefix, observedAt: now, isActive: true, tenantResolutionStatus: 'resolved', tenantMappingId: null,
        tenantMappingVersion: 0, tenantResolutionDetailsJson: '{"code":"dedicated_engine_tenant"}', createdAt: now, updatedAt: now,
      },
      {
        id: decisionRuntimeResourceId, tenantId, engineId, resourceKind: 'decision_definition', resourceKey: 'invoice-risk', runtimeTenantId: '',
        engineResourceId: null, deploymentId: null, projectId: null, fileId: null, version: 1, labelsJson: '{}', lineageJson: '{}',
        source: 'test', sourceRef: prefix, observedAt: now, isActive: true, tenantResolutionStatus: 'resolved', tenantMappingId: null,
        tenantMappingVersion: 0, tenantResolutionDetailsJson: '{"code":"dedicated_engine_tenant"}', createdAt: now, updatedAt: now,
      },
      {
        id: siblingRuntimeResourceId, tenantId, engineId, resourceKind: 'process_definition', resourceKey: 'invoice-sibling', runtimeTenantId: '',
        engineResourceId: null, deploymentId: null, projectId: null, fileId: null, version: 1, labelsJson: '{}', lineageJson: '{}',
        source: 'test', sourceRef: prefix, observedAt: now, isActive: true, tenantResolutionStatus: 'resolved', tenantMappingId: null,
        tenantMappingVersion: 0, tenantResolutionDetailsJson: '{"code":"dedicated_engine_tenant"}', createdAt: now, updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    if (skip) return;
    const dataSource = await getDataSource();
    await dataSource.getRepository(ConfigBundleRuntimeReconciliationTask).delete({ applyRunId: [forwardApplyRunId, rollbackApplyRunId].filter(Boolean) as any });
    await dataSource.getRepository(ConfigBundleApplyRun).delete({ id: [forwardApplyRunId, rollbackApplyRunId].filter(Boolean) as any });
    await dataSource.getRepository(RbacRoleAssignment).delete({ sourceRef });
    await dataSource.getRepository(AuthzGroupMembership).delete({ groupId: importedGroupIds.length ? importedGroupIds as any : '__missing__' });
    await dataSource.getRepository(RuntimeResourceSetMaterialization).delete({ runtimeResourceSetId: importedRuntimeResourceSetIds.length ? importedRuntimeResourceSetIds as any : '__missing__' });
    await dataSource.getRepository(RuntimeResourceSet).delete({ sourceRef });
    await dataSource.getRepository(AuthzGroup).delete({ sourceRef });
    if (importedRoleId) await dataSource.getRepository(RbacRolePermission).delete({ roleId: importedRoleId });
    await dataSource.getRepository(RbacRole).delete({ sourceRef });
    await dataSource.getRepository(RuntimeResource).delete({ id: [importedRuntimeResourceId, decisionRuntimeResourceId, siblingRuntimeResourceId].filter(Boolean) as any });
    await cleanupEngines([engineId]);
    await cleanupSeededData(prefix, [], [adminUserId, allowedUserId, deniedUserId].filter(Boolean));
  });

  it('applies exact process and decision group READ grants as resource-aware Effective Access and rolls back only the imported records', async () => {
    if (skip) return;
    const engineKey = camundaNativeGrantExternalEngineKey(engineId);
    const draft = new CamundaNativeGrantDraftService().generate({
      base: migrationBase(),
      engineKey,
      engineReferenceMode: 'existing_registered',
      classifications: [{
        sourceAuthorizationId: 'synthetic-native-invoice-read', disposition: 'proposed', reasonCodes: ['group_grant_process_definition'],
        principal: { type: 'group', groupId: 'synthetic-operators' }, resourceKind: 'process_definition', resourceId: 'invoice-process',
        runtimeTenantId: null, mappedActionIds: ['engine.runtime.process-definitions.read'],
      }, {
        sourceAuthorizationId: 'synthetic-native-risk-read', disposition: 'proposed', reasonCodes: ['group_grant_decision_definition'],
        principal: { type: 'group', groupId: 'synthetic-risk' }, resourceKind: 'decision_definition', resourceId: 'invoice-risk',
        runtimeTenantId: null, mappedActionIds: ['engine.runtime.decisions.read'],
      }],
      groupMappings: [
        { nativeGroupId: 'synthetic-operators', target: { mode: 'new', key: groupKey, name: 'Synthetic operators' } },
        { nativeGroupId: 'synthetic-risk', target: { mode: 'new', key: `${groupKey}-risk`, name: 'Synthetic risk readers' } },
      ],
    });
    const policy = {
      credentiallessCustomerSidecarsEnabled: false,
      externalEngineReferences: [{ key: engineKey, engineId }],
    };
    const forward = await configBundleApplyService.apply({
      bundle: draft.bundle,
      files: draft.files,
      expectedPreviewHash: draft.canonicalHash,
      expectedTenantScope: tenantId,
      acknowledgements: [],
      idempotencyKey: `${prefix}:forward`,
      identityReconciliationMode: 'none',
      tenantId,
      actorId: adminUserId,
    }, policy);
    forwardApplyRunId = forward.applyRunId || '';
    // Two groups, two runtime-resource sets, one role, two assignments, and
    // the tenant-scoped governance-settings record are owned by the import.
    expect(forward).toMatchObject({ created: 8, updated: 0, archived: 0 });
    expect(forward.applyRunId).toBeTruthy();
    expect(await configBundleRuntimeReconciliationTaskService.drainApplyRun({ applyRunId: forwardApplyRunId })).toMatchObject({ status: 'completed', failedTaskCount: 0 });

    const dataSource = await getDataSource();
    const [groups, runtimeSets, role] = await Promise.all([
      dataSource.getRepository(AuthzGroup).find({ where: { tenantId, sourceRef }, order: { key: 'ASC' } }),
      dataSource.getRepository(RuntimeResourceSet).find({ where: { tenantId, sourceRef }, order: { key: 'ASC' } }),
      dataSource.getRepository(RbacRole).findOne({ where: { sourceRef } }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups).toEqual(expect.arrayContaining([expect.objectContaining({ key: groupKey, source: 'config', sourceRef, isArchived: false })]));
    expect(runtimeSets).toHaveLength(2);
    expect(runtimeSets).toEqual(expect.arrayContaining([
      expect.objectContaining({ engineId, resourceKind: 'process_definition', isArchived: false }),
      expect.objectContaining({ engineId, resourceKind: 'decision_definition', isArchived: false }),
    ]));
    expect(role).toMatchObject({ sourceRef, isArchived: false });
    importedGroupIds = groups.map((group) => group.id);
    importedRuntimeResourceSetIds = runtimeSets.map((runtimeSet) => runtimeSet.id);
    importedRoleId = role!.id;

    // Configuration-owned groups are intentionally not mutable through the
    // manual membership API. Model the normal provider/synchronization write
    // path that places a representative user in the imported target group.
    await dataSource.getRepository(AuthzGroupMembership).insert(groups.map((group) => ({
      id: generateId(), tenantId, groupId: group.id, userId: allowedUserId,
      source: 'sso', sourceRef: `fixture:${prefix}`, expiresAt: null, createdById: adminUserId,
      createdAt: Date.now(), updatedAt: Date.now(),
    })));
    await expect(permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
      userId: allowedUserId, tenantId, resourceType: 'engine_runtime_resource', resourceId: importedRuntimeResourceId,
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
      userId: allowedUserId, tenantId, resourceType: 'engine_runtime_resource', resourceId: decisionRuntimeResourceId,
    })).resolves.toBe(true);
    await expect(permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
      userId: allowedUserId, tenantId, resourceType: 'engine_runtime_resource', resourceId: siblingRuntimeResourceId,
    })).resolves.toBe(false);
    await expect(permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
      userId: deniedUserId, tenantId, resourceType: 'engine_runtime_resource', resourceId: importedRuntimeResourceId,
    })).resolves.toBe(false);
    expect(await dataSource.getRepository(Engine).findOneBy({ id: engineId })).toMatchObject({ configKey: null, tenantId, runtimeAccessScope: 'resource_aware' });

    const rollback = rollbackFor(draft);
    const rollbackPreview = configBundlePreviewService.compile(rollback, policy).preview;
    const rollbackDiff = await configBundleDiffService.diff(rollback, tenantId, policy);
    expect(rollbackPreview).toMatchObject({ valid: true });
    expect(rollbackDiff).toMatchObject({ valid: true });
    expect(rollbackDiff.changes.filter((change) => change.operation === 'archive')).toHaveLength(7);
    const reversed = await configBundleApplyService.apply({
      ...rollback,
      expectedPreviewHash: rollbackPreview.canonicalHash!,
      expectedTenantScope: tenantId,
      acknowledgements: rollbackDiff.requiredAcknowledgements,
      idempotencyKey: `${prefix}:rollback`,
      identityReconciliationMode: 'none',
      tenantId,
      actorId: adminUserId,
    }, policy);
    rollbackApplyRunId = reversed.applyRunId || '';
    expect(reversed).toMatchObject({ created: 0, updated: 0, archived: 7 });
    await expect(permissionService.hasPermission(EnginePermissions.INSTANCE_VIEW, {
      userId: allowedUserId, tenantId, resourceType: 'engine_runtime_resource', resourceId: importedRuntimeResourceId,
    })).resolves.toBe(false);
    expect(await dataSource.getRepository(AuthzGroup).find({ where: { sourceRef } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ isArchived: true, sourceRef }),
      expect.objectContaining({ isArchived: true, sourceRef }),
    ]));
    expect(await dataSource.getRepository(RuntimeResourceSet).find({ where: { sourceRef } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ isArchived: true, sourceRef }),
      expect.objectContaining({ isArchived: true, sourceRef }),
    ]));
    expect(await dataSource.getRepository(Engine).findOneBy({ id: engineId })).toMatchObject({ configKey: null, tenantId, runtimeAccessScope: 'resource_aware' });
  });
});
