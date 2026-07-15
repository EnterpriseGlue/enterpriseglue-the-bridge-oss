import { In, IsNull, type EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { ConfigRoleAssignmentOverride } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigRoleAssignmentOverride.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { engineSetKeyIdentity } from './EngineSetService.js';
import { ssoNormalizedIdentityService } from './SsoNormalizedIdentityService.js';
import { resolveConfigEngineSetSelector } from './config-engine-set-selector.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { permissionService } from './permissions.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { createHash } from 'node:crypto';
import { configBundleDiffService, type ConfigBundleDiffChange } from './ConfigBundleDiffService.js';
import { configBundlePreviewService, type ConfigBundlePolicyContext, type ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';
import { configBundleSecretPreflightService } from './ConfigBundleSecretPreflightService.js';
import { configBundleIdentityReplayTaskService } from './ConfigBundleIdentityReplayTaskService.js';
import { configBundleRuntimeReconciliationTaskService } from './ConfigBundleRuntimeReconciliationTaskService.js';
import { archiveIdentityProviderInStore } from './IdentityProviderService.js';
import { identityProviderMembershipSourceRefs } from './IdentityEntitlementMappingService.js';
import { authzGroupService } from './AuthzGroupService.js';
import { hashCanonicalConfig } from './config-bundle-hash.js';

export type ConfigBundleIdentityReconciliationMode = 'none' | 'preview' | 'apply';

export interface ConfigBundleApplyInput extends ConfigBundlePreviewInput {
  expectedPreviewHash: string;
  expectedSecretPreflightHash?: string | null;
  acknowledgements?: string[];
  idempotencyKey?: string | null;
  expectedTenantScope?: string | null;
  identityReconciliationMode?: ConfigBundleIdentityReconciliationMode;
  tenantId?: string | null;
  actorId: string;
}

export interface ConfigBundleApplyResult {
  canonicalHash: string;
  created: number;
  updated: number;
  archived: number;
  changes: ConfigBundleDiffChange[];
  reconciliation: {
    status: 'completed';
    engineSetCount: number;
    runtimeResourceSetCount: number;
    engineCount: number;
    identitySnapshot: {
      mode: ConfigBundleIdentityReconciliationMode;
      status: 'not_needed' | 'skipped' | 'previewed' | 'completed' | 'truncated' | 'failed';
      providerCount: number;
      scanned: number;
      created: number;
      removed: number;
      failed: number;
    };
    runtimeReconciliation: {
      status: 'not_needed' | 'queued' | 'completed' | 'failed';
      taskId: string | null;
      engineSetCount: number;
      runtimeResourceSetCount: number;
      engineCount: number;
    };
  };
  idempotent?: boolean;
  applyRunId?: string;
}

function entries(files: Record<string, unknown>, path: string, property: string): any[] {
  const file = files[path] as Record<string, unknown> | undefined;
  return Array.isArray(file?.[property]) ? file[property] as any[] : [];
}

function canonicalEngineKeyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

function runtimeResourceSetKeyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

function identityMappingConfigKeyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

function selectorFingerprint(selector: unknown): string {
  return createHash('sha256').update(JSON.stringify(selector)).digest('hex');
}

function objectFingerprint(kind: string, key: string, value: unknown): string {
  return hashCanonicalConfig({ kind, key, value });
}

function engineCredentialFields(auth: any): Record<string, string | null> {
  if (auth.type === 'basic') return { authType: 'basic', username: auth.username, passwordEnc: `ref:${auth.passwordRef}`, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null };
  if (auth.type === 'bearer') return { authType: 'bearer', username: null, passwordEnc: `ref:${auth.tokenRef}`, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null };
  if (auth.type === 'oauth2-client-credentials') return { authType: 'oauth2-client-credentials', username: auth.username, passwordEnc: `ref:${auth.passwordRef}`, oauthTokenUrl: auth.tokenUrl, oauthScopes: auth.scopes || null, oauthAudience: auth.audience || null };
  return { authType: 'none', username: null, passwordEnc: null, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null };
}

function providerConfiguration(provider: any): Record<string, unknown> {
  return {
    ...(provider[provider.type] || {}),
    allowVerifiedEmailLinking: provider.allowVerifiedEmailLinking === true,
    ...(provider.authorizationAttributeKeys?.length ? { authorizationAttributeKeys: provider.authorizationAttributeKeys } : {}),
  };
}

function fail(message: string, statusCode: number): never {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  throw error;
}

function tenantScopeKey(tenantId?: string | null): string {
  return tenantId?.trim() || 'platform';
}

function parseStoredReconciliation(value: unknown): ConfigBundleApplyResult['reconciliation'] {
  const emptyIdentitySnapshot = { mode: 'apply' as const, status: 'not_needed' as const, providerCount: 0, scanned: 0, created: 0, removed: 0, failed: 0 };
  const emptyRuntimeReconciliation = { status: 'not_needed' as const, taskId: null, engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0 };
  if (!value || typeof value !== 'object') {
    return { status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0, identitySnapshot: emptyIdentitySnapshot, runtimeReconciliation: emptyRuntimeReconciliation };
  }

  const reconciliation = value as Record<string, unknown>;
  if (
    reconciliation.status !== 'completed'
    || !Number.isInteger(reconciliation.engineSetCount)
    || !Number.isInteger(reconciliation.runtimeResourceSetCount)
    || !Number.isInteger(reconciliation.engineCount)
    || (reconciliation.engineSetCount as number) < 0
    || (reconciliation.runtimeResourceSetCount as number) < 0
    || (reconciliation.engineCount as number) < 0
  ) {
    return { status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0, identitySnapshot: emptyIdentitySnapshot, runtimeReconciliation: emptyRuntimeReconciliation };
  }

  const snapshot = reconciliation.identitySnapshot as Record<string, unknown> | undefined;
  const identitySnapshot = snapshot
    && ['none', 'preview', 'apply'].includes(String(snapshot.mode || 'apply'))
    && ['not_needed', 'skipped', 'previewed', 'completed', 'truncated', 'failed'].includes(String(snapshot.status))
    && ['providerCount', 'scanned', 'created', 'removed', 'failed'].every((key) => Number.isInteger(snapshot[key]) && (snapshot[key] as number) >= 0)
    ? { mode: (snapshot.mode || 'apply') as ConfigBundleIdentityReconciliationMode, status: snapshot.status as ConfigBundleApplyResult['reconciliation']['identitySnapshot']['status'], providerCount: snapshot.providerCount as number, scanned: snapshot.scanned as number, created: snapshot.created as number, removed: snapshot.removed as number, failed: snapshot.failed as number }
    : emptyIdentitySnapshot;
  const runtime = reconciliation.runtimeReconciliation as Record<string, unknown> | undefined;
  const runtimeReconciliation = runtime
    && ['not_needed', 'queued', 'completed', 'failed'].includes(String(runtime.status))
    && (runtime.taskId === null || typeof runtime.taskId === 'string')
    && ['engineSetCount', 'runtimeResourceSetCount', 'engineCount'].every((key) => Number.isInteger(runtime[key]) && (runtime[key] as number) >= 0)
    ? { status: runtime.status as ConfigBundleApplyResult['reconciliation']['runtimeReconciliation']['status'], taskId: runtime.taskId as string | null, engineSetCount: runtime.engineSetCount as number, runtimeResourceSetCount: runtime.runtimeResourceSetCount as number, engineCount: runtime.engineCount as number }
    : emptyRuntimeReconciliation;

  return {
    status: 'completed',
    engineSetCount: reconciliation.engineSetCount as number,
    runtimeResourceSetCount: reconciliation.runtimeResourceSetCount as number,
    engineCount: reconciliation.engineCount as number,
    identitySnapshot,
    runtimeReconciliation,
  };
}

function parseStoredResult(value: string | null): ConfigBundleApplyResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ConfigBundleApplyResult>;
    if (!parsed || typeof parsed.canonicalHash !== 'string' || !Array.isArray(parsed.changes)) return null;
    return {
      canonicalHash: parsed.canonicalHash,
      created: Number(parsed.created || 0),
      updated: Number(parsed.updated || 0),
      archived: Number(parsed.archived || 0),
      changes: parsed.changes,
      reconciliation: parseStoredReconciliation(parsed.reconciliation),
    };
  } catch {
    return null;
  }
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
}

function auditApplyChangeSummary(change: ConfigBundleDiffChange): Record<string, unknown> {
  const beforeState = change.operation === 'create' ? 'absent' : change.operation === 'archive' ? 'config_owned_active' : 'persisted';
  const afterState = change.operation === 'archive' ? 'archived' : change.operation === 'create' ? 'config_owned_active' : 'config_reconciled';
  return {
    objectType: change.objectType,
    key: change.key,
    operation: change.operation,
    ...(change.currentId ? { currentId: change.currentId } : {}),
    before: { state: beforeState },
    after: { state: afterState },
    ...(change.permissionChanges ? { permissionChangeSummary: { additions: change.permissionChanges.additions.length, removals: change.permissionChanges.removals.length } } : {}),
    ...(change.affectedAssignmentCount !== undefined ? { affectedAssignmentCount: change.affectedAssignmentCount } : {}),
    ...(change.runtimeResourceChanges ? { runtimeResourceSummary: { matched: change.runtimeResourceChanges.matchedCount, currentlyMaterialized: change.runtimeResourceChanges.currentlyMaterialized.length, unmatchedSelectors: change.runtimeResourceChanges.unmatchedSelectors.length } } : {}),
  };
}

function replayExistingApplyRun(run: ConfigBundleApplyRun, canonicalHash: string, bundleKey: string): ConfigBundleApplyResult {
  if (run.canonicalHash !== canonicalHash || run.bundleKey !== bundleKey) {
    return fail('Idempotency key is already associated with a different configuration bundle', 409);
  }
  if (run.status === 'succeeded') {
    const result = parseStoredResult(run.resultJson);
    if (!result) return fail('Configuration apply receipt is unavailable for this idempotency key', 409);
    return { ...result, idempotent: true, applyRunId: run.id };
  }
  return fail(`Configuration apply for this idempotency key is ${run.status}`, 409);
}

async function writeAudit(manager: EntityManager, input: {
  tenantId: string | null;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await manager.getRepository(AuditLog).insert({
    id: generateId(),
    tenantId: input.tenantId,
    userId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ipAddress: null,
    userAgent: null,
    details: JSON.stringify(input.details),
    createdAt: Date.now(),
  });
}

/**
 * Applies the first config-managed vertical. The bundle compiler and diff are
 * shared with the API/UI, and unsupported object families fail instead of
 * being silently ignored.
 */
class ConfigBundleApplyService {
  async apply(input: ConfigBundleApplyInput, policy?: ConfigBundlePolicyContext): Promise<ConfigBundleApplyResult> {
    const identityReconciliationMode = input.identityReconciliationMode || 'apply';
    if (!['none', 'preview', 'apply'].includes(identityReconciliationMode)) {
      return fail('Identity reconciliation mode must be none, preview, or apply', 422);
    }
    const compilation = configBundlePreviewService.compile(input, policy);
    if (!compilation.preview.valid || !compilation.manifest || !compilation.files || !compilation.preview.canonicalHash) {
      return fail('Configuration bundle is invalid', 422);
    }
    const manifest = compilation.manifest as { apiVersion: string; metadata: { key: string }; mode: string };
    if (manifest.mode === 'preview_only') {
      return fail('A preview_only bundle cannot be applied', 422);
    }
    if (input.expectedPreviewHash !== compilation.preview.canonicalHash) {
      return fail('Preview hash does not match the submitted configuration bundle', 409);
    }
    if (input.expectedSecretPreflightHash) {
      const secretPreflight = configBundleSecretPreflightService.check({ bundle: input.bundle, files: input.files }, policy);
      if (!secretPreflight.valid || !secretPreflight.available || secretPreflight.availabilityHash !== input.expectedSecretPreflightHash) {
        return fail('Secret reference availability changed or is no longer available since preflight', 409);
      }
    }
    const unsupported = Object.keys(compilation.files).filter((path) => !['./roles.json', './groups.json', './engines.json', './engine-sets.json', './runtime-resource-sets.json', './assignments.json', './project-engine-targets.json', './identity-providers.json', './identity-mappings.json'].includes(path));
    if (unsupported.length > 0) {
      return fail(`Config apply does not yet support: ${unsupported.join(', ')}`, 422);
    }

    const tenantId = input.tenantId || null;
    const actualTenantScope = tenantScopeKey(tenantId);
    const expectedTenantScope = input.expectedTenantScope?.trim() || null;
    if (expectedTenantScope && expectedTenantScope !== actualTenantScope) {
      return fail(`Configuration bundle target tenant does not match the authenticated tenant (${actualTenantScope})`, 409);
    }
    const dataSource = await getDataSource();
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    let applyRunId: string | null = null;
    if (idempotencyKey) {
      const existing = await dataSource.getRepository(ConfigBundleApplyRun).findOne({
        where: { tenantScopeKey: actualTenantScope, idempotencyKey },
      });
      if (existing) return replayExistingApplyRun(existing, compilation.preview.canonicalHash, manifest.metadata.key);
    }
    const diff = await configBundleDiffService.diff(input, tenantId, policy);
    if (!diff.valid || !diff.canonicalHash) return fail('Configuration bundle diff is invalid', 422);
    const conflicts = diff.changes.filter((change) => change.operation === 'conflict');
    if (conflicts.length > 0) {
      return fail(`Config apply conflicts with manually owned objects: ${conflicts.map((change) => `${change.objectType}:${change.key}`).join(', ')}`, 409);
    }
    const acknowledgements = new Set(input.acknowledgements || []);
    const missingAcknowledgements = diff.requiredAcknowledgements.filter((acknowledgement) => !acknowledgements.has(acknowledgement));
    if (missingAcknowledgements.length > 0) {
      return fail(`Configuration apply requires acknowledgement: ${missingAcknowledgements.join(', ')}`, 422);
    }

    const runRepo = dataSource.getRepository(ConfigBundleApplyRun);
    const scopeKey = actualTenantScope;
    applyRunId = generateId();
    try {
      await runRepo.insert({
        id: applyRunId,
        tenantId,
        tenantScopeKey: scopeKey,
        bundleKey: manifest.metadata.key,
        bundleApiVersion: manifest.apiVersion,
        canonicalHash: diff.canonicalHash,
        idempotencyKey,
        actorId: input.actorId,
        status: 'pending',
        resultJson: null,
        errorMessage: null,
        completedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (idempotencyKey) {
        const concurrent = await runRepo.findOne({ where: { tenantScopeKey: scopeKey, idempotencyKey } });
        if (concurrent) return replayExistingApplyRun(concurrent, diff.canonicalHash, manifest.metadata.key);
      }
      throw error;
    }

    const desiredRoles = new Map(entries(compilation.files, './roles.json', 'roles').map((role) => [role.key, role]));
    const desiredGroups = new Map(entries(compilation.files, './groups.json', 'groups').map((group) => [group.key, group]));
    const desiredEngines = new Map(entries(compilation.files, './engines.json', 'engines').map((engine) => [engine.key, engine]));
    const desiredEngineSets = new Map(entries(compilation.files, './engine-sets.json', 'engineSets').map((set) => [set.key, set]));
    const desiredRuntimeResourceSets = new Map(entries(compilation.files, './runtime-resource-sets.json', 'runtimeResourceSets').map((set) => [set.key, set]));
    const desiredAssignments = entries(compilation.files, './assignments.json', 'assignments');
    const desiredTargets = entries(compilation.files, './project-engine-targets.json', 'projectEngineTargets');
    const desiredIdentityMappings = entries(compilation.files, './identity-mappings.json', 'identityMappings');
    const desiredIdentityProviders = new Map(entries(compilation.files, './identity-providers.json', 'identityProviders').map((provider) => [provider.key, provider]));
    const materializeIds: string[] = [];
    const materializeRuntimeResourceSetIds: string[] = [];
    const changedEngineIds: string[] = [];
    const replayProviderIds: string[] = [];
    const now = Date.now();
    let created = 0;
    let updated = 0;
    let archived = 0;

    try {
    await dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(RbacRole);
      const groupRepo = manager.getRepository(AuthzGroup);
      const engineRepo = manager.getRepository(Engine);
      const engineSetRepo = manager.getRepository(EngineSet);
      const runtimeResourceSetRepo = manager.getRepository(RuntimeResourceSet);
      const runtimeResourceRepo = manager.getRepository(RuntimeResource);
      const assignmentRepo = manager.getRepository(RbacRoleAssignment);
      const assignmentOverrideRepo = manager.getRepository(ConfigRoleAssignmentOverride);
      const projectRepo = manager.getRepository(Project);
      const targetRepo = manager.getRepository(ProjectEngineTarget);
      const providerRepo = manager.getRepository(IdentityProvider);
      const identityMappingRepo = manager.getRepository(IdentityEntitlementMapping);
      const groupMembershipRepo = manager.getRepository(AuthzGroupMembership);
      const rolePermissionRepo = manager.getRepository(RbacRolePermission);

      for (const change of diff.changes) {
        if (change.operation === 'noop' || change.operation === 'conflict') continue;
        if (change.objectType === 'role') {
          const desired = desiredRoles.get(change.key);
          const sourceHash = desired ? objectFingerprint('role', desired.key, desired) : objectFingerprint('role', change.key, { archived: true });
          if (change.operation === 'create' && desired) {
            const permissions = compilation.preview.expandedRolePermissions?.[desired.key] || desired.permissions || [];
            const { id: roleId } = await permissionService.createCustomRole({
              tenantId,
              key: desired.key,
              name: desired.name,
              description: desired.description || null,
              scope: desired.scope,
              permissionIds: permissions,
              source: 'config',
              sourceRef: `config_bundle:${manifest.metadata.key}`,
              ownershipMode: desired.ownershipMode || 'config_locked',
              sourceHash,
              lastAppliedAt: now,
              driftStatus: 'in_sync',
              createdById: input.actorId,
            }, manager);
            created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            await roleRepo.update({ id: change.currentId }, {
              name: desired.name,
              description: desired.description || null,
              scope: desired.scope,
              isArchived: false,
              isAssignable: true,
              ownershipMode: desired.ownershipMode || 'config_locked',
              sourceHash,
              lastAppliedAt: now,
              driftStatus: 'in_sync',
              updatedAt: now,
            });
            await rolePermissionRepo.delete({ roleId: change.currentId });
            const permissions = compilation.preview.expandedRolePermissions?.[desired.key] || desired.permissions || [];
            if (permissions.length > 0) {
              await rolePermissionRepo.insert(permissions.map((permissionId: string) => ({
                id: `${change.currentId}:${permissionId}`,
                roleId: change.currentId,
                permissionId,
                createdAt: now,
              })));
            }
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.role.update', resourceType: 'role', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, roleKey: desired.key, canonicalHash: diff.canonicalHash } });
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            await roleRepo.update({ id: change.currentId }, {
              isArchived: true,
              isAssignable: false,
              sourceHash,
              lastAppliedAt: now,
              driftStatus: 'in_sync',
              updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.role.archive', resourceType: 'role', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, roleKey: change.key, canonicalHash: diff.canonicalHash } });
            archived += 1;
          }
        }

        if (change.objectType === 'group') {
          const desired = desiredGroups.get(change.key);
          const sourceHash = desired ? objectFingerprint('group', desired.key, desired) : objectFingerprint('group', change.key, { archived: true });
          if (change.operation === 'create' && desired) {
            const { id: groupId } = await authzGroupService.createGroup({
              tenantId,
              key: desired.key,
              name: desired.name,
              description: desired.description || null,
              source: 'config',
              sourceRef: `config_bundle:${manifest.metadata.key}`,
              ownershipMode: desired.ownershipMode || 'config_locked',
              sourceHash,
              lastAppliedAt: now,
              driftStatus: 'in_sync',
              isSystem: false,
              createdById: input.actorId,
            }, manager);
            created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            await groupRepo.update({ id: change.currentId }, {
              name: desired.name,
              description: desired.description || null,
              isArchived: false,
              ownershipMode: desired.ownershipMode || 'config_locked',
              sourceHash,
              lastAppliedAt: now,
              driftStatus: 'in_sync',
              updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.group.update', resourceType: 'authz_group', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, groupKey: desired.key, canonicalHash: diff.canonicalHash } });
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            await groupRepo.update({ id: change.currentId }, {
              isArchived: true,
              sourceHash,
              lastAppliedAt: now,
              driftStatus: 'in_sync',
              updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.group.archive', resourceType: 'authz_group', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, groupKey: change.key, canonicalHash: diff.canonicalHash } });
            archived += 1;
          }
        }

        if (change.objectType === 'engine') {
          const desired = desiredEngines.get(change.key);
          const sourceHash = desired ? objectFingerprint('engine', desired.key, desired) : objectFingerprint('engine', change.key, { archived: true });
          if (change.operation === 'create' && desired) {
            const engineId = generateId();
            await engineRepo.insert({
              id: engineId, tenantId, name: desired.name, baseUrl: desired.baseUrl, type: desired.type,
              externalId: desired.externalId || null, labelsJson: JSON.stringify(desired.labels || {}),
              registrationSource: 'config', sourceRef: `config_bundle:${manifest.metadata.key}`,
              configKey: desired.key, configKeyIdentity: canonicalEngineKeyIdentity(tenantId, desired.key),
              sourceHash, lastAppliedAt: now, ownershipMode: desired.ownershipMode || 'config_locked',
              managementMode: 'hybrid', fieldOwnershipJson: null, driftStatus: 'in_sync', lifecycleStatus: 'active',
              lastExternalSyncAt: null, capabilitiesJson: null, capabilityStatus: null, externalUpdatedAt: null,
              ...engineCredentialFields(desired.auth), version: desired.version || null, ownerId: null, delegateId: null,
              environmentTagId: desired.environmentTagId || null, environmentLocked: false,
              runtimeAccessScope: desired.runtimeAccessScope, deploymentIntegration: desired.deploymentIntegration, metadataDiscoveryEnabled: desired.metadataDiscoveryEnabled, deploymentDiscoveryEnabled: desired.deploymentDiscoveryEnabled, reconciliationIntervalSeconds: desired.reconciliationIntervalSeconds, lastMetadataReconciledAt: null, lastMetadataReconciliationStatus: null, pipelineReceiptEnabled: desired.pipelineReceiptEnabled, connectionMode: desired.connectionMode,
              createdAt: now, updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.engine.create', resourceType: 'engine', resourceId: engineId, details: { bundleKey: manifest.metadata.key, engineKey: desired.key, canonicalHash: diff.canonicalHash } });
            changedEngineIds.push(engineId);
            created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            await engineRepo.update({ id: change.currentId }, {
              name: desired.name, baseUrl: desired.baseUrl, type: desired.type, externalId: desired.externalId || null,
              labelsJson: JSON.stringify(desired.labels || {}), sourceHash, lastAppliedAt: now,
              ownershipMode: desired.ownershipMode || 'config_locked', lifecycleStatus: 'active', driftStatus: 'in_sync',
              ...engineCredentialFields(desired.auth), version: desired.version || null, environmentTagId: desired.environmentTagId || null,
              runtimeAccessScope: desired.runtimeAccessScope, deploymentIntegration: desired.deploymentIntegration, metadataDiscoveryEnabled: desired.metadataDiscoveryEnabled, deploymentDiscoveryEnabled: desired.deploymentDiscoveryEnabled, reconciliationIntervalSeconds: desired.reconciliationIntervalSeconds, pipelineReceiptEnabled: desired.pipelineReceiptEnabled, connectionMode: desired.connectionMode, updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.engine.update', resourceType: 'engine', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, engineKey: desired.key, canonicalHash: diff.canonicalHash } });
            changedEngineIds.push(change.currentId);
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            await engineRepo.update({ id: change.currentId }, { lifecycleStatus: 'decommissioned', driftStatus: 'decommissioned', lastAppliedAt: now, updatedAt: now });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.engine.decommission', resourceType: 'engine', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, engineKey: change.key, canonicalHash: diff.canonicalHash } });
            archived += 1;
          }
        }
        if (change.objectType === 'engine_set') {
          const desired = desiredEngineSets.get(change.key);
          const sourceHash = desired ? objectFingerprint('engine_set', desired.key, desired) : objectFingerprint('engine_set', change.key, { archived: true });
          const engineRows = await engineRepo.find();
          const keyToId = new Map(engineRows.filter((engine) => engine.configKey).map((engine) => [engine.configKey!, engine.id]));
          if (change.operation === 'create' && desired) {
            const id = generateId();
            const selector = resolveConfigEngineSetSelector(desired.selector, keyToId);
            await engineSetRepo.insert({ id, tenantId, key: desired.key, engineSetKeyIdentity: engineSetKeyIdentity(tenantId, desired.key), name: desired.name, description: desired.description || null, selectorJson: JSON.stringify(selector), selectorFingerprint: '', source: 'config', sourceRef: `config_bundle:${manifest.metadata.key}`, ownershipMode: desired.ownershipMode || 'config_locked', sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', isArchived: false, createdById: input.actorId, lastMaterializedAt: null, materializationStatus: 'pending', materializationError: null, createdAt: now, updatedAt: now });
            materializeIds.push(id); created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            const selector = resolveConfigEngineSetSelector(desired.selector, keyToId);
            await engineSetRepo.update({ id: change.currentId }, { name: desired.name, description: desired.description || null, selectorJson: JSON.stringify(selector), isArchived: false, ownershipMode: desired.ownershipMode || 'config_locked', sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', materializationStatus: 'pending', updatedAt: now });
            materializeIds.push(change.currentId); updated += 1;
          } else if (change.operation === 'archive' && change.currentId) { await engineSetRepo.update({ id: change.currentId }, { isArchived: true, sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', materializationStatus: 'archived', updatedAt: now }); archived += 1; }
        }
        if (change.objectType === 'runtime_resource_set') {
          const desired = desiredRuntimeResourceSets.get(change.key);
          const sourceHash = desired ? objectFingerprint('runtime_resource_set', desired.key, desired) : objectFingerprint('runtime_resource_set', change.key, { archived: true });
          const engineRows = await engineRepo.find();
          const engineByConfigKey = new Map(engineRows.filter((engine) => engine.configKey).map((engine) => [engine.configKey!, engine]));
          const engine = desired ? engineByConfigKey.get(desired.engineRef.engineKey) : null;
          if (desired && !engine) fail(`Runtime Resource Set ${desired.key} references an unresolved engine`, 422);
          const values = desired && engine ? {
            name: desired.name,
            description: desired.description || null,
            engineId: engine.id,
            resourceKind: desired.resourceKind,
            selectorJson: JSON.stringify(desired.selector),
            selectorFingerprint: selectorFingerprint(desired.selector),
            runtimeTenantId: desired.runtimeTenantId || null,
            sourceHash,
            lastAppliedAt: now,
            driftStatus: 'in_sync',
            isArchived: false,
            updatedAt: now,
          } : null;
          if (change.operation === 'create' && desired && values) {
            const id = generateId();
            await runtimeResourceSetRepo.insert({ id, tenantId, key: desired.key, runtimeResourceSetKeyIdentity: runtimeResourceSetKeyIdentity(tenantId, desired.key), ...values, source: 'config', sourceRef: `config_bundle:${manifest.metadata.key}`, createdById: input.actorId, createdAt: now });
            materializeRuntimeResourceSetIds.push(id);
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.runtime_resource_set.create', resourceType: 'runtime_resource_set', resourceId: id, details: { bundleKey: manifest.metadata.key, runtimeResourceSetKey: desired.key, canonicalHash: diff.canonicalHash } });
            created += 1;
          } else if (change.operation === 'update' && change.currentId && values) {
            await runtimeResourceSetRepo.update({ id: change.currentId }, values);
            materializeRuntimeResourceSetIds.push(change.currentId);
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.runtime_resource_set.update', resourceType: 'runtime_resource_set', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, runtimeResourceSetKey: desired!.key, canonicalHash: diff.canonicalHash } });
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            await runtimeResourceSetRepo.update({ id: change.currentId }, { isArchived: true, sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', updatedAt: now });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.runtime_resource_set.archive', resourceType: 'runtime_resource_set', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, runtimeResourceSetKey: change.key, canonicalHash: diff.canonicalHash } });
            archived += 1;
          }
        }
        if (change.objectType === 'identity_provider') {
          const desired = desiredIdentityProviders.get(change.key);
          const sourceHash = desired ? objectFingerprint('identity_provider', desired.key, desired) : objectFingerprint('identity_provider', change.key, { archived: true });
          const values = desired ? {
            protocol: desired.type,
            isEnabled: desired.enabled,
            authenticationMode: desired.authenticationMode,
            directoryTenantId: desired.directoryTenantId || null,
            configurationJson: JSON.stringify(providerConfiguration(desired)),
            syncJson: JSON.stringify(desired.sync),
            ownershipMode: desired.ownershipMode || 'config_locked',
            sourceRef: `config_bundle:${manifest.metadata.key}`,
            sourceHash,
            lastAppliedAt: now,
            driftStatus: 'in_sync',
            updatedAt: now,
          } : null;
          if (change.operation === 'create' && desired && values) {
            const id = generateId();
            await providerRepo.insert({ id, tenantId, key: desired.key, providerKeyIdentity: `${tenantId || 'platform'}:${desired.key}`, ...values, createdAt: now });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.identity_provider.create', resourceType: 'identity_provider', resourceId: id, details: { bundleKey: manifest.metadata.key, providerKey: desired.key, canonicalHash: diff.canonicalHash } });
            created += 1;
          } else if (change.operation === 'update' && change.currentId && values) {
            await providerRepo.update({ id: change.currentId }, values);
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.identity_provider.update', resourceType: 'identity_provider', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, providerKey: desired!.key, canonicalHash: diff.canonicalHash } });
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            const provider = await providerRepo.findOne({ where: { id: change.currentId } });
            if (!provider) fail(`Identity provider ${change.key} disappeared during apply`, 409);
            const cleanup = await archiveIdentityProviderInStore(manager, provider);
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.identity_provider.archive', resourceType: 'identity_provider', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, providerKey: change.key, canonicalHash: diff.canonicalHash, cleanup } });
            archived += 1;
          }
        }
      }

      // Resolve references after staged role/group/engine/Engine Set writes.
      const [roles, groups, engines, engineSets, runtimeResourceSets] = await Promise.all([
        roleRepo.find(), groupRepo.find(), engineRepo.find(), engineSetRepo.find(), runtimeResourceSetRepo.find(),
      ]);
      const roleByKey = new Map(roles.map((role) => [role.key, role]));
      const groupByKey = new Map(groups.map((group) => [group.key, group]));
      const engineByKey = new Map(engines.filter((engine) => engine.configKey).map((engine) => [engine.configKey!, engine]));
      const engineSetByKey = new Map(engineSets.map((set) => [set.key, set]));
      const runtimeResourceSetByKey = new Map(runtimeResourceSets.map((set) => [set.key, set]));
      const sourceRef = `config_bundle:${manifest.metadata.key}`;
      const desiredKeys = new Set<string>();
      for (const assignment of desiredAssignments) {
        const sourceHash = objectFingerprint('assignment', assignment.key || hashCanonicalConfig(assignment), assignment);
        if (assignment.principal.type !== 'group') fail('Config apply currently supports group principals only', 422);
        if (!['platform', 'engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set'].includes(assignment.scope.type)) fail(`Config apply does not yet support ${assignment.scope.type} assignment scopes`, 422);
        const role = roleByKey.get(assignment.roleKey);
        const group = groupByKey.get(assignment.principal.key);
        if (!role || !group) fail(`Config assignment references an unresolved role or group: ${assignment.roleKey}`, 422);
        let scopeId: string | null = assignment.scope.type === 'platform' ? null
          : assignment.scope.type === 'engine' ? engineByKey.get(assignment.scope.engineKey)?.id || null
          : assignment.scope.type === 'engine_set' ? engineSetByKey.get(assignment.scope.engineSetKey)?.id || null
          : assignment.scope.type === 'engine_runtime_resource_set' ? runtimeResourceSetByKey.get(assignment.scope.runtimeResourceSetKey)?.id || null
          : null;
        if (assignment.scope.type === 'engine_runtime_resource') {
          const engine = engineByKey.get(assignment.scope.engineKey);
          if (engine) {
            const runtimeResource = await runtimeResourceRepo.findOne({ where: {
              engineId: engine.id, resourceKind: assignment.scope.resourceKind, resourceKey: assignment.scope.resourceKey,
              runtimeTenantId: assignment.scope.runtimeTenantId || '', isActive: true,
            } });
            scopeId = runtimeResource?.id || null;
          }
        }
        if (assignment.scope.type !== 'platform' && !scopeId) fail('Config assignment references an unresolved scope', 422);
        const assignmentKey = canonicalRoleAssignmentKey({ tenantId, principalType: 'group', principalId: group.id, roleId: role.id, scopeType: assignment.scope.type, scopeId, source: 'config', sourceRef });
        desiredKeys.add(assignmentKey);
        const existing = await assignmentRepo.findOne({ where: { assignmentKey } });
        if (!existing) {
          const assignmentId = generateId();
          await assignmentRepo.insert({ id: assignmentId, tenantId, principalType: 'group', principalId: group.id, assignmentKey, roleId: role.id, scopeType: assignment.scope.type, scopeId: scopeId || null, source: 'config', sourceRef, ownershipMode: assignment.ownershipMode || 'config_locked', sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', expiresAt: assignment.expiresAt || null, lastSeenAt: now, createdById: input.actorId, createdAt: now, updatedAt: now });
          await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.assignment.create', resourceType: 'role_assignment', resourceId: assignmentId, details: { bundleKey: manifest.metadata.key, roleKey: assignment.roleKey, principalGroupKey: assignment.principal.key, scopeType: assignment.scope.type, canonicalHash: diff.canonicalHash } });
          created += 1;
        } else if (existing.expiresAt !== (assignment.expiresAt || null) || existing.ownershipMode !== (assignment.ownershipMode || 'config_locked')) {
          await assignmentRepo.update({ id: existing.id }, { expiresAt: assignment.expiresAt || null, ownershipMode: assignment.ownershipMode || 'config_locked', sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', lastSeenAt: now, updatedAt: now });
          updated += 1;
        }
        await assignmentOverrideRepo.delete({ assignmentKey, sourceRef });
      }
      if (manifest.mode === 'authoritative') {
        const existing = await assignmentRepo.find({ where: { source: 'config', sourceRef } });
        const staleIds = existing.filter((assignment) => !desiredKeys.has(assignment.assignmentKey)).map((assignment) => assignment.id);
        if (staleIds.length > 0) {
          await assignmentRepo.delete(staleIds);
          for (const id of staleIds) await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.assignment.delete', resourceType: 'role_assignment', resourceId: id, details: { bundleKey: manifest.metadata.key, canonicalHash: diff.canonicalHash } });
          archived += staleIds.length;
        }
      }

      const targetKeys = new Set<string>();
      for (const target of desiredTargets) {
        const sourceHash = objectFingerprint('project_engine_target', target.key || `${target.projectRef.id}:${target.engineRef.engineKey}`, target);
        if (!target.projectRef.id) fail('Config project-engine targets currently require projectRef.id', 422);
        const project = await projectRepo.findOne({ where: { id: target.projectRef.id } });
        const engine = engineByKey.get(target.engineRef.engineKey);
        if (!project || !engine) fail('Config project-engine target references an unresolved project or engine', 422);
        const pairKey = `${project.id}:${engine.id}`;
        targetKeys.add(pairKey);
        const existing = await targetRepo.findOne({ where: { projectId: project.id, engineId: engine.id } });
        const values = {
          status: target.status, source: 'config', sourceRef, ownershipMode: target.ownershipMode || 'config_locked', sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', externalSystemId: null, externalProjectId: null, externalEngineId: null, externalTargetId: null,
          allowManualDeploy: target.allowManualDeploy, allowCiDeploy: target.allowCiDeploy, allowApiDeploy: target.allowApiDeploy, allowImport: target.allowImport,
          approvedById: null, approvalStatus: 'not_required', approvedAt: null, policyTagsJson: null, diagnosticsJson: null, lastSeenAt: now, updatedAt: now,
        };
        if (!existing) {
          const targetId = generateId();
          await targetRepo.insert({ id: targetId, tenantId, projectId: project.id, engineId: engine.id, ...values, createdById: input.actorId, createdAt: now });
          await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.project_engine_target.create', resourceType: 'project_engine_target', resourceId: targetId, details: { bundleKey: manifest.metadata.key, projectId: project.id, engineKey: target.engineRef.engineKey, canonicalHash: diff.canonicalHash } });
          created += 1;
        } else {
          const transfersOwnership = existing.source !== 'config' || existing.sourceRef !== sourceRef;
          if (transfersOwnership && !target.transferOwnership) fail(`Config target conflicts with existing ${existing.source} target`, 409);
          if (!transfersOwnership && target.transferOwnership) fail('Config target ownership transfer no longer matches the previewed target', 409);
          await targetRepo.update({ id: existing.id }, values);
          await writeAudit(manager, { tenantId, actorId: input.actorId, action: transfersOwnership ? 'authz.config_bundle.project_engine_target.transfer_ownership' : 'authz.config_bundle.project_engine_target.update', resourceType: 'project_engine_target', resourceId: existing.id, details: { bundleKey: manifest.metadata.key, projectId: project.id, engineKey: target.engineRef.engineKey, canonicalHash: diff.canonicalHash, ...(transfersOwnership ? { previousSource: existing.source, previousSourceRef: existing.sourceRef || null, transferReason: target.transferOwnership!.reason } : {}) } });
          updated += 1;
        }
      }
      if (manifest.mode === 'authoritative') {
        const existing = await targetRepo.find({ where: { source: 'config', sourceRef } });
        for (const target of existing) {
          if (targetKeys.has(`${target.projectId}:${target.engineId}`)) continue;
          await targetRepo.update({ id: target.id }, { status: 'archived', sourceHash: diff.canonicalHash, lastAppliedAt: now, driftStatus: 'in_sync', updatedAt: now });
          await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.project_engine_target.archive', resourceType: 'project_engine_target', resourceId: target.id, details: { bundleKey: manifest.metadata.key, canonicalHash: diff.canonicalHash } });
          archived += 1;
        }
      }

      const providers = await providerRepo.find();
      const providerByKey = new Map(providers.map((provider) => [provider.key, provider]));
      const mappingKeys = new Set<string>();
      for (const mapping of desiredIdentityMappings) {
        const sourceHash = objectFingerprint('identity_mapping', mapping.key, mapping);
        const provider = providerByKey.get(mapping.providerKey);
        const group = groupByKey.get(mapping.targetGroupKey);
        if (!provider || !group) fail(`Identity mapping references an unresolved provider or group: ${mapping.key}`, 422);
        mappingKeys.add(mapping.key);
        const existing = await identityMappingRepo.findOne({ where: { tenantId, configKey: mapping.key } as any });
        const values = { providerId: provider.id, configKey: mapping.key, configKeyIdentity: identityMappingConfigKeyIdentity(tenantId, mapping.key), sourceRef, sourceHash, lastAppliedAt: now, driftStatus: 'in_sync', entitlementType: mapping.source.type, externalId: mapping.source.externalId || null, matchOperator: mapping.source.operator, targetGroupId: group.id, syncMode: mapping.syncMode, isActive: true, updatedAt: now };
        if (!existing) {
          const mappingId = generateId();
          await identityMappingRepo.insert({ id: mappingId, tenantId, ...values, createdAt: now });
          await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.identity_mapping.create', resourceType: 'identity_entitlement_mapping', resourceId: mappingId, details: { bundleKey: manifest.metadata.key, mappingKey: mapping.key, providerKey: mapping.providerKey, groupKey: mapping.targetGroupKey, canonicalHash: diff.canonicalHash } });
          created += 1;
          replayProviderIds.push(provider.id);
        } else {
          const mappingChanged = existing.providerId !== values.providerId
            || existing.targetGroupId !== values.targetGroupId
            || existing.entitlementType !== values.entitlementType
            || existing.externalId !== values.externalId
            || existing.matchOperator !== values.matchOperator
            || existing.syncMode !== values.syncMode
            || !existing.isActive;
          if (mappingChanged) {
            await groupMembershipRepo.delete({ tenantId: tenantId || IsNull(), source: 'identity_provider', sourceRef: In(identityProviderMembershipSourceRefs(existing.providerId, existing.id)) });
            await identityMappingRepo.update({ id: existing.id }, values);
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.identity_mapping.update', resourceType: 'identity_entitlement_mapping', resourceId: existing.id, details: { bundleKey: manifest.metadata.key, mappingKey: mapping.key, canonicalHash: diff.canonicalHash, membershipCleanup: 'source_scoped' } });
            updated += 1;
            replayProviderIds.push(provider.id);
          }
        }
      }
      if (manifest.mode === 'authoritative') {
        const existing = await identityMappingRepo.find({ where: { tenantId, sourceRef } as any });
        for (const mapping of existing) {
          if (mapping.configKey && mappingKeys.has(mapping.configKey)) continue;
          await groupMembershipRepo.delete({ tenantId: tenantId || IsNull(), source: 'identity_provider', sourceRef: In(identityProviderMembershipSourceRefs(mapping.providerId, mapping.id)) });
          await identityMappingRepo.update({ id: mapping.id }, { isActive: false, updatedAt: now });
          await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.identity_mapping.disable', resourceType: 'identity_entitlement_mapping', resourceId: mapping.id, details: { bundleKey: manifest.metadata.key, canonicalHash: diff.canonicalHash, membershipCleanup: 'source_scoped' } });
          archived += 1;
          replayProviderIds.push(mapping.providerId);
        }
      }
      await writeAudit(manager, {
        tenantId,
        actorId: input.actorId,
        action: 'authz.config_bundle.apply',
        resourceType: 'config_bundle_apply_run',
        resourceId: applyRunId!,
        details: {
          bundleKey: manifest.metadata.key,
          mode: manifest.mode,
          canonicalHash: diff.canonicalHash,
          changes: diff.changes.filter((change) => change.operation !== 'noop').map(auditApplyChangeSummary),
          redaction: 'Config payload and secret references omitted',
        },
      });
    });
      const runtimeCounts = {
        engineSetCount: materializeIds.length,
        runtimeResourceSetCount: materializeRuntimeResourceSetIds.length,
        engineCount: new Set(changedEngineIds).size,
      };
      let runtimeReconciliation: ConfigBundleApplyResult['reconciliation']['runtimeReconciliation'] = {
        status: 'not_needed', taskId: null, ...runtimeCounts,
      };
      if (runtimeCounts.engineSetCount || runtimeCounts.runtimeResourceSetCount || runtimeCounts.engineCount) {
        try {
          const task = await configBundleRuntimeReconciliationTaskService.enqueue({
            tenantId,
            applyRunId: applyRunId!,
            engineSetIds: materializeIds,
            runtimeResourceSetIds: materializeRuntimeResourceSetIds,
            engineIds: changedEngineIds,
          });
          runtimeReconciliation = { status: task ? 'queued' : 'not_needed', taskId: task?.id || null, ...runtimeCounts };
        } catch {
          runtimeReconciliation = { status: 'failed', taskId: null, ...runtimeCounts };
        }
      }
      const providerIds = Array.from(new Set(replayProviderIds.filter(Boolean)));
      let identitySnapshot: ConfigBundleApplyResult['reconciliation']['identitySnapshot'] = { mode: identityReconciliationMode, status: 'not_needed', providerCount: 0, scanned: 0, created: 0, removed: 0, failed: 0 };
      if (providerIds.length > 0) {
        if (identityReconciliationMode === 'none') {
          identitySnapshot = { mode: 'none', status: 'skipped', providerCount: providerIds.length, scanned: 0, created: 0, removed: 0, failed: 0 };
        } else if (identityReconciliationMode === 'preview') {
          try {
            const previews = await Promise.all(providerIds.map((providerId) => ssoNormalizedIdentityService.previewMemberships({ tenantId, providerId })));
            identitySnapshot = {
              mode: 'preview',
              status: previews.some((preview) => preview.truncated) ? 'truncated' : previews.some((preview) => preview.failed > 0) ? 'failed' : 'previewed',
              providerCount: providerIds.length,
              scanned: previews.reduce((total, preview) => total + preview.scanned, 0),
              created: previews.reduce((total, preview) => total + preview.additions, 0),
              removed: previews.reduce((total, preview) => total + preview.removals, 0),
              failed: previews.reduce((total, preview) => total + preview.failed, 0),
            };
          } catch {
            identitySnapshot = { mode: 'preview', status: 'failed', providerCount: providerIds.length, scanned: 0, created: 0, removed: 0, failed: 1 };
          }
        } else {
          try {
            const replays = await Promise.all(providerIds.map((providerId) => ssoNormalizedIdentityService.replayMemberships({ tenantId, providerIds: [providerId] })));
            const replay = {
              scanned: replays.reduce((total, item) => total + item.scanned, 0),
              created: replays.reduce((total, item) => total + item.created, 0),
              removed: replays.reduce((total, item) => total + item.removed, 0),
              failed: replays.reduce((total, item) => total + item.failed, 0),
              truncated: replays.some((item) => item.truncated),
            };
            let queueFailures = 0;
            await Promise.all(replays.map(async (item, index) => {
              if (!item.truncated || !item.nextCursor) return;
              try {
                await configBundleIdentityReplayTaskService.enqueue({
                  tenantId,
                  applyRunId: applyRunId!,
                  providerId: providerIds[index],
                  cursor: item.nextCursor,
                  initial: item,
                });
              } catch {
                queueFailures += 1;
              }
            }));
            identitySnapshot = {
              mode: 'apply',
              status: queueFailures > 0 || replay.failed > 0 ? 'failed' : replay.truncated ? 'truncated' : 'completed',
              providerCount: providerIds.length,
              scanned: replay.scanned,
              created: replay.created,
              removed: replay.removed,
              failed: replay.failed + queueFailures,
            };
          } catch {
            identitySnapshot = { mode: 'apply', status: 'failed', providerCount: providerIds.length, scanned: 0, created: 0, removed: 0, failed: 1 };
          }
        }
      }

      const result = {
        canonicalHash: diff.canonicalHash,
        created,
        updated,
        archived,
        changes: diff.changes,
        reconciliation: {
          status: 'completed' as const,
          ...runtimeCounts,
          identitySnapshot,
          runtimeReconciliation,
        },
        ...(applyRunId ? { applyRunId } : {}),
      };
      if (applyRunId) {
        await dataSource.getRepository(ConfigBundleApplyRun).update({ id: applyRunId }, {
          status: 'succeeded',
          resultJson: JSON.stringify(result),
          errorMessage: null,
          completedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      return result;
    } catch (error) {
      if (applyRunId) {
        await dataSource.getRepository(ConfigBundleApplyRun).update({ id: applyRunId }, {
          status: 'failed',
          errorMessage: errorSummary(error),
          completedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      throw error;
    }
  }
}

export const configBundleApplyService = new ConfigBundleApplyService();
