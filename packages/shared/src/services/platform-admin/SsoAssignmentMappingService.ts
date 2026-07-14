import { createHash } from 'node:crypto';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { SsoAssignmentMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoAssignmentMapping.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import {
  EnginePermissions,
  PlatformPermissions,
  permissionService,
  SYSTEM_ROLE_IDS,
} from './permissions.js';
import { authzGroupService } from './AuthzGroupService.js';
import { engineSetKeyIdentity } from './EngineSetService.js';
import { identityEntitlementMappingService, type ManagedIdentityEntitlementMapping } from './IdentityEntitlementMappingService.js';
import { ssoEngineAccessSnapshotService } from './SsoEngineAccessSnapshotService.js';
import { recordLegacyMappingConversion } from './LegacyMappingConversionAudit.js';
import {
  authorizationAttributeKeysFromConfiguration,
  providerNeutralLegacyEntitlement,
  ssoClaimMatches,
  type ClaimType,
  type SsoClaimOperator,
  type SsoClaims,
  ssoClaimOperatorIsRegex,
  ssoClaimOperatorRequiresValue,
} from './SsoClaimsMappingService.js';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';

type SsoAssignmentMappingStore = DataSource | EntityManager;

export type SsoAssignmentTargetSelectorType = 'engine_id' | 'all_engines' | 'external_engine_id' | 'engine_label';
export type SsoAssignmentSyncMode = 'authoritative' | 'additive';
export type SsoEngineRoleId = string;
type DynamicEngineSetSelector = { mode: 'all' } | { mode: 'labels'; labels: Record<string, string>; labelMatch: 'all' };
type ResolvedAssignmentTarget = {
  resourceType: 'engine';
  resourceId: string | null;
  scopeType: 'engine' | 'engine_set';
  scopeId: string | null;
};

export interface SsoAssignmentMappingInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  providerId?: string | null;
  claimType: ClaimType;
  claimKey: string;
  claimValue: string;
  claimOperator?: SsoClaimOperator | null;
  targetSelectorType: SsoAssignmentTargetSelectorType;
  targetEngineId?: string | null;
  targetExternalEngineId?: string | null;
  targetLabelKey?: string | null;
  targetLabelValue?: string | null;
  targetRoleId: SsoEngineRoleId;
  syncMode?: SsoAssignmentSyncMode;
  priority?: number;
  isActive?: boolean;
  riskAcknowledged?: boolean;
}

export interface SsoAssignmentMappingView {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  claimType: ClaimType;
  claimKey: string;
  claimValue: string;
  claimOperator: SsoClaimOperator | null;
  targetScope: 'engine';
  targetSelectorType: SsoAssignmentTargetSelectorType;
  targetEngineId: string | null;
  targetExternalEngineId: string | null;
  targetLabelKey: string | null;
  targetLabelValue: string | null;
  targetRoleId: SsoEngineRoleId;
  syncMode: SsoAssignmentSyncMode;
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LegacySsoAssignmentMappingMigrationInput {
  providerKey: string;
  targetGroupKey?: string;
  newGroup?: { key: string; name: string; description?: string | null };
  createdById?: string | null;
}

export interface ProviderNeutralSsoAssignmentMigrationResult {
  legacyMappingId: string;
  providerKey: string;
  identityMapping: ManagedIdentityEntitlementMapping;
  assignment: { id: string; warnings: string[] };
  created: boolean;
  createdGroup: AuthzGroup | null;
}

const ALLOWED_SSO_ENGINE_ROLE_IDS = new Set<string>([
  SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
  SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
]);

type SsoAssignmentMappingRiskReason =
  | 'all_engines_selector'
  | 'engine_owner_role'
  | 'engine_delegate_role'
  | 'regex_claim_operator'
  | 'engine_secret_permission'
  | 'unredacted_audit_permission'
  | 'permanent_delete_permission';

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function legacyAssignmentSourceRef(mapping: Pick<SsoAssignmentMapping, 'id' | 'providerId'>): string {
  return mapping.providerId ? `legacy_sso:${mapping.providerId}:mapping:${mapping.id}` : mapping.id;
}

function assignmentSourceRefCriteria(sourceRef: string, mappingId: string): string | ReturnType<typeof In> {
  return sourceRef === mappingId ? mappingId : In([sourceRef, mappingId]);
}

function getStaticMappingRiskReasons(
  input: Pick<SsoAssignmentMappingInput, 'targetSelectorType' | 'targetRoleId' | 'claimOperator' | 'isActive'>
): SsoAssignmentMappingRiskReason[] {
  if (input.isActive === false) return [];
  const riskReasons: SsoAssignmentMappingRiskReason[] = [];
  if (input.targetSelectorType === 'all_engines') {
    riskReasons.push('all_engines_selector');
  }
  if (input.targetRoleId === SYSTEM_ROLE_IDS.ENGINE_OWNER) {
    riskReasons.push('engine_owner_role');
  }
  if (input.targetRoleId === SYSTEM_ROLE_IDS.ENGINE_DELEGATE) {
    riskReasons.push('engine_delegate_role');
  }
  if (ssoClaimOperatorIsRegex(input.claimOperator)) {
    riskReasons.push('regex_claim_operator');
  }
  return riskReasons;
}

function mappingRiskReasonRequiresAcknowledgement(reason: SsoAssignmentMappingRiskReason): boolean {
  return reason !== 'engine_owner_role' && reason !== 'engine_delegate_role';
}

function addTenantScopeFilter(qb: { andWhere: (...args: any[]) => any }, alias: string, tenantId?: string | null): void {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return;
  qb.andWhere(`(${alias}.tenantId = :tenantId OR ${alias}.tenantId IS NULL)`, { tenantId: normalizedTenantId });
}

function toView(mapping: SsoAssignmentMapping): SsoAssignmentMappingView {
  return {
    id: mapping.id,
    tenantId: mapping.tenantId,
    providerId: mapping.providerId,
    claimType: mapping.claimType as ClaimType,
    claimKey: mapping.claimKey,
    claimValue: mapping.claimValue,
    claimOperator: mapping.claimOperator as SsoClaimOperator | null,
    targetScope: 'engine',
    targetSelectorType: mapping.targetSelectorType as SsoAssignmentTargetSelectorType,
    targetEngineId: mapping.targetEngineId,
    targetExternalEngineId: mapping.targetExternalEngineId,
    targetLabelKey: mapping.targetLabelKey,
    targetLabelValue: mapping.targetLabelValue,
    targetRoleId: mapping.targetRoleId as SsoEngineRoleId,
    syncMode: mapping.syncMode as SsoAssignmentSyncMode,
    priority: Number(mapping.priority),
    isActive: Boolean(mapping.isActive),
    createdAt: Number(mapping.createdAt),
    updatedAt: Number(mapping.updatedAt),
  };
}

function parseEngineLabels(labelsJson: string | null | undefined): Record<string, string> {
  if (!labelsJson) return {};
  try {
    const parsed = JSON.parse(labelsJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
}

function selectorFingerprint(selector: DynamicEngineSetSelector): string {
  return createHash('sha256')
    .update(stableJson(selector))
    .digest('hex');
}

function keyFromMappingId(mappingId: string): string {
  return `sso-${mappingId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function dynamicEngineSetSelectorForMapping(
  mapping: Pick<SsoAssignmentMapping, 'targetSelectorType' | 'targetLabelKey' | 'targetLabelValue'>
): DynamicEngineSetSelector | null {
  if (mapping.targetSelectorType === 'all_engines') {
    return { mode: 'all' };
  }
  if (mapping.targetSelectorType === 'engine_label' && mapping.targetLabelKey && mapping.targetLabelValue) {
    return {
      mode: 'labels',
      labels: { [mapping.targetLabelKey]: mapping.targetLabelValue },
      labelMatch: 'all',
    };
  }
  return null;
}

async function recordSsoAssignmentAudit(
  dataSource: SsoAssignmentMappingStore,
  entry: {
    tenantId?: string | null;
    action: string;
    assignmentId: string;
    userId: string;
    roleId: string;
    resourceId: string | null;
    scopeType?: string | null;
    scopeId?: string | null;
    mappingId: string;
  }
): Promise<void> {
  try {
    await dataSource.getRepository(AuditLog).insert({
      id: generateId(),
      tenantId: normalizeTenantId(entry.tenantId),
      userId: entry.userId,
      action: entry.action,
      resourceType: 'role_assignment',
      resourceId: entry.assignmentId,
      ipAddress: null,
      userAgent: null,
      details: JSON.stringify({
        assignmentId: entry.assignmentId,
        tenantId: normalizeTenantId(entry.tenantId),
        assignedUserId: entry.userId,
        roleId: entry.roleId,
        resourceType: 'engine',
        resourceId: entry.resourceId,
        scopeType: entry.scopeType ?? 'engine',
        scopeId: entry.scopeId ?? entry.resourceId,
        source: 'sso',
        sourceMappingId: entry.mappingId,
      }),
      createdAt: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to write SSO assignment audit log:', error);
  }
}

async function recordSsoAssignmentMappingAudit(
  dataSource: SsoAssignmentMappingStore,
  entry: {
    tenantId?: string | null;
    actorUserId?: string | null;
    action: string;
    mappingId: string;
    mapping?: SsoAssignmentMappingInput;
    riskReasons?: SsoAssignmentMappingRiskReason[];
    changedFields?: string[];
  }
): Promise<void> {
  try {
    const riskReasons = entry.riskReasons ?? [];
    await dataSource.getRepository(AuditLog).insert({
      id: generateId(),
      tenantId: normalizeTenantId(entry.tenantId ?? entry.mapping?.tenantId),
      userId: entry.actorUserId ?? null,
      action: entry.action,
      resourceType: 'sso_assignment_mapping',
      resourceId: entry.mappingId,
      ipAddress: null,
      userAgent: null,
      details: JSON.stringify({
        mappingId: entry.mappingId,
        tenantId: normalizeTenantId(entry.tenantId ?? entry.mapping?.tenantId),
        providerId: entry.mapping?.providerId ?? null,
        claimType: entry.mapping?.claimType,
        claimKey: entry.mapping?.claimKey,
        claimValue: entry.mapping?.claimValue,
        claimOperator: entry.mapping?.claimOperator ?? null,
        targetScope: 'engine',
        targetSelectorType: entry.mapping?.targetSelectorType,
        targetEngineId: entry.mapping?.targetEngineId ?? null,
        targetExternalEngineId: entry.mapping?.targetExternalEngineId ?? null,
        targetLabelKey: entry.mapping?.targetLabelKey ?? null,
        targetLabelValue: entry.mapping?.targetLabelValue ?? null,
        targetRoleId: entry.mapping?.targetRoleId,
        syncMode: entry.mapping?.syncMode ?? 'authoritative',
        isActive: entry.mapping?.isActive ?? true,
        source: 'sso_assignment_mapping',
        riskAcknowledged: riskReasons.some(mappingRiskReasonRequiresAcknowledgement) ? true : undefined,
        riskReasons: riskReasons.length > 0 ? riskReasons : undefined,
        changedFields: entry.changedFields,
      }),
      createdAt: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to write SSO assignment mapping audit log:', error);
  }
}

class SsoAssignmentMappingServiceClass {
  /**
   * Creates the group-first replacement for an exact-engine legacy mapping.
   * Dynamic selectors intentionally require an explicit Engine Set design so a
   * migration can never silently broaden an engine grant.
   */
  async migrateToProviderNeutral(id: string, input: LegacySsoAssignmentMappingMigrationInput): Promise<ProviderNeutralSsoAssignmentMigrationResult> {
    if (Boolean(input.targetGroupKey) === Boolean(input.newGroup)) throw Errors.validation('Provide exactly one of targetGroupKey or newGroup');
    const providerKey = input.providerKey.trim();
    const createdById = input.createdById?.trim();
    if (!providerKey) throw Errors.validation('providerKey is required');
    if (!createdById) throw Errors.validation('createdById is required');

    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const legacyMapping = await manager.getRepository(SsoAssignmentMapping).findOneBy({ id });
      if (!legacyMapping) throw Errors.notFound('SSO engine assignment mapping');
      if (!legacyMapping.isActive) throw Errors.validation('Only active SSO engine assignment mappings can be migrated');
      if (legacyMapping.targetSelectorType !== 'engine_id' || !legacyMapping.targetEngineId) {
        throw Errors.validation('Only exact engine targets can be migrated automatically. Recreate all-engine, external-id, and label selectors as an explicit group assignment with an Engine Set.');
      }
      const needsProviderAttributeAllowlist = legacyMapping.claimType === 'custom' && legacyMapping.claimOperator === 'equals';
      if (!needsProviderAttributeAllowlist && !providerNeutralLegacyEntitlement(legacyMapping, [])) {
        throw Errors.validation('Only equals, contains, and exists legacy claim operators can be migrated automatically. Recreate wildcard, negated, and regex mappings explicitly.');
      }
      const tenantId = normalizeTenantId(legacyMapping.tenantId);
      const providerWhere = tenantId ? { tenantId, key: providerKey } : { tenantId: IsNull(), key: providerKey };
      const provider = await manager.getRepository(IdentityProvider).findOne({ where: providerWhere });
      if (!provider) throw Errors.notFound('Identity provider');
      const entitlement = providerNeutralLegacyEntitlement(legacyMapping, authorizationAttributeKeysFromConfiguration(provider.configurationJson));
      if (!entitlement) {
        throw Errors.validation('Only group/role equals, contains, or exists mappings, exact email-domain mappings, and allowlisted exact custom claims can be migrated automatically. Recreate broad, negated, regex, wildcard, or unallowlisted mappings explicitly.');
      }
      const { entitlementType, externalId, matchOperator } = entitlement;

      const engine = await manager.getRepository(Engine).findOne({
        where: tenantId
          ? [{ id: legacyMapping.targetEngineId, tenantId }, { id: legacyMapping.targetEngineId, tenantId: IsNull() }]
          : { id: legacyMapping.targetEngineId },
        select: ['id', 'tenantId'],
      });
      if (!engine) throw Errors.notFound('Target engine');

      const targetGroupKey = input.newGroup?.key || input.targetGroupKey!.trim();
      const groupRepo = manager.getRepository(AuthzGroup);
      let group = await groupRepo.findOne({ where: tenantId ? { tenantId, key: targetGroupKey, isArchived: false } : { tenantId: IsNull(), key: targetGroupKey, isArchived: false } });
      let createdGroup: AuthzGroup | null = null;
      if (!group && input.newGroup) {
        const created = await authzGroupService.createGroup({ tenantId, key: input.newGroup.key, name: input.newGroup.name, description: input.newGroup.description, source: 'manual', createdById }, manager);
        group = await groupRepo.findOneBy({ id: created.id });
        createdGroup = group;
      }
      if (!group) throw Errors.notFound('Authorization group');
      if ((group.tenantId || null) !== tenantId) throw Errors.validation('The replacement group must use the legacy mapping tenant scope');

      const disabledReasons = await this.getDisabledPlatformRiskReasons(manager, legacyMapping);
      if (disabledReasons.length > 0) {
        throw Errors.forbidden(`The legacy mapping cannot be converted while its SSO risk controls are disabled: ${disabledReasons.join(', ')}`);
      }

      const existing = await manager.getRepository(IdentityEntitlementMapping).findOne({
        where: {
          tenantId: tenantId || IsNull(), providerId: provider.id, targetGroupId: group.id,
          entitlementType, externalId: externalId === null ? IsNull() : externalId,
          matchOperator, syncMode: legacyMapping.syncMode, isActive: true,
        } as any,
      });
      const identityMapping = existing
        ? {
          id: existing.id, providerId: provider.id, providerKey: provider.key, targetGroupId: group.id, targetGroupKey: group.key,
          entitlementType, externalId, matchOperator,
          syncMode: existing.syncMode as SsoAssignmentSyncMode, isActive: true, configKey: existing.configKey, sourceRef: existing.sourceRef,
        }
        : await identityEntitlementMappingService.create({
          providerKey: provider.key, targetGroupKey: group.key, entitlementType,
          externalId, matchOperator, syncMode: legacyMapping.syncMode as SsoAssignmentSyncMode,
        }, tenantId, manager);
      const assignment = await permissionService.assignRole({
        tenantId, createdById, principalType: 'group', principalId: group.id, roleId: legacyMapping.targetRoleId,
        resourceType: 'engine', resourceId: engine.id, source: 'legacy', sourceRef: `sso_assignment_mapping:${legacyMapping.id}`,
      }, manager);
      const created = !existing;
      await recordLegacyMappingConversion(manager, {
        tenantId,
        actorId: createdById,
        family: 'engine_assignment',
        legacyMappingId: legacyMapping.id,
        identityMappingId: identityMapping.id,
        providerId: provider.id,
        providerKey: provider.key,
        created,
      });
      return { legacyMappingId: legacyMapping.id, providerKey: provider.key, identityMapping, assignment, created, createdGroup };
    });
  }

  async getAllMappings(tenantId?: string | null): Promise<SsoAssignmentMappingView[]> {
    const dataSource = await getDataSource();
    const normalizedTenantId = normalizeTenantId(tenantId);
    const mappings = await dataSource.getRepository(SsoAssignmentMapping).find({
      where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : undefined,
      order: { priority: 'DESC', updatedAt: 'DESC' },
    });
    return mappings.map(toView);
  }

  async createMapping(input: SsoAssignmentMappingInput): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    await this.validateMappingInput(dataSource, input);
    const riskReasons = await this.requireMappingRiskAcknowledgement(dataSource, input);
    await this.validatePlatformRiskSettings(dataSource, input);

    const id = generateId();
    const now = Date.now();
    await dataSource.getRepository(SsoAssignmentMapping).insert({
      id,
      tenantId: normalizeTenantId(input.tenantId),
      providerId: input.providerId || null,
      claimType: input.claimType,
      claimKey: input.claimKey,
      claimValue: input.claimValue || '',
      claimOperator: input.claimOperator || null,
      targetScope: 'engine',
      targetSelectorType: input.targetSelectorType,
      targetEngineId: input.targetSelectorType === 'engine_id' ? input.targetEngineId || null : null,
      targetExternalEngineId: input.targetSelectorType === 'external_engine_id' ? input.targetExternalEngineId || null : null,
      targetLabelKey: input.targetSelectorType === 'engine_label' ? input.targetLabelKey || null : null,
      targetLabelValue: input.targetSelectorType === 'engine_label' ? input.targetLabelValue || null : null,
      targetRoleId: input.targetRoleId,
      syncMode: input.syncMode || 'authoritative',
      priority: input.priority ?? 0,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });

    await recordSsoAssignmentMappingAudit(dataSource, {
      action: 'authz.sso_assignment_mapping.create',
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      mappingId: id,
      mapping: input,
      riskReasons,
    });
    if (input.isActive !== false) {
      await this.reconcileDynamicEngineSetForMapping(dataSource, {
        id,
        tenantId: normalizeTenantId(input.tenantId),
        providerId: input.providerId || null,
        targetSelectorType: input.targetSelectorType,
        targetLabelKey: input.targetLabelKey || null,
        targetLabelValue: input.targetLabelValue || null,
      });
    }

    return { id };
  }

  async updateMapping(id: string, updates: Partial<SsoAssignmentMappingInput>): Promise<void> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(SsoAssignmentMapping);
    const existing = await repo.findOneBy({ id });
    if (!existing) {
      throw new Error('SSO assignment mapping not found');
    }

    const merged: SsoAssignmentMappingInput = {
      providerId: updates.providerId !== undefined ? updates.providerId : existing.providerId,
      tenantId: updates.tenantId !== undefined ? updates.tenantId : existing.tenantId,
      claimType: (updates.claimType || existing.claimType) as ClaimType,
      claimKey: updates.claimKey || existing.claimKey,
      claimValue: updates.claimValue !== undefined ? updates.claimValue : existing.claimValue,
      claimOperator: updates.claimOperator !== undefined
        ? updates.claimOperator
        : existing.claimOperator as SsoClaimOperator | null,
      targetSelectorType: (updates.targetSelectorType || existing.targetSelectorType) as SsoAssignmentTargetSelectorType,
      targetEngineId: updates.targetEngineId !== undefined ? updates.targetEngineId : existing.targetEngineId,
      targetExternalEngineId: updates.targetExternalEngineId !== undefined ? updates.targetExternalEngineId : existing.targetExternalEngineId,
      targetLabelKey: updates.targetLabelKey !== undefined ? updates.targetLabelKey : existing.targetLabelKey,
      targetLabelValue: updates.targetLabelValue !== undefined ? updates.targetLabelValue : existing.targetLabelValue,
      targetRoleId: (updates.targetRoleId || existing.targetRoleId) as SsoEngineRoleId,
      syncMode: (updates.syncMode || existing.syncMode) as SsoAssignmentSyncMode,
      priority: updates.priority !== undefined ? updates.priority : existing.priority,
      isActive: updates.isActive !== undefined ? updates.isActive : existing.isActive,
      riskAcknowledged: updates.riskAcknowledged,
    };

    await this.validateMappingInput(dataSource, merged);
    const riskReasons = await this.requireMappingRiskAcknowledgement(dataSource, merged);
    await this.validatePlatformRiskSettings(dataSource, merged);

    await repo.update({ id }, {
      tenantId: normalizeTenantId(merged.tenantId),
      providerId: merged.providerId || null,
      claimType: merged.claimType,
      claimKey: merged.claimKey,
      claimValue: merged.claimValue || '',
      claimOperator: merged.claimOperator || null,
      targetScope: 'engine',
      targetSelectorType: merged.targetSelectorType,
      targetEngineId: merged.targetSelectorType === 'engine_id' ? merged.targetEngineId || null : null,
      targetExternalEngineId: merged.targetSelectorType === 'external_engine_id' ? merged.targetExternalEngineId || null : null,
      targetLabelKey: merged.targetSelectorType === 'engine_label' ? merged.targetLabelKey || null : null,
      targetLabelValue: merged.targetSelectorType === 'engine_label' ? merged.targetLabelValue || null : null,
      targetRoleId: merged.targetRoleId,
      syncMode: merged.syncMode,
      priority: merged.priority ?? 0,
      isActive: merged.isActive ?? true,
      updatedAt: Date.now(),
    });

    await this.deleteAssignmentsForMapping(dataSource, id);
    await recordSsoAssignmentMappingAudit(dataSource, {
      action: 'authz.sso_assignment_mapping.update',
      tenantId: merged.tenantId,
      actorUserId: updates.actorUserId,
      mappingId: id,
      mapping: merged,
      riskReasons,
      changedFields: Object.keys(updates).filter((field) => !['actorUserId', 'riskAcknowledged', 'tenantId'].includes(field)),
    });
    if (merged.isActive === false) {
      await this.archiveDynamicEngineSetForMapping(dataSource, {
        id,
        providerId: merged.providerId || null,
      }, merged.tenantId);
    } else {
      await this.reconcileDynamicEngineSetForMapping(dataSource, {
        id,
        tenantId: normalizeTenantId(merged.tenantId),
        providerId: merged.providerId || null,
        targetSelectorType: merged.targetSelectorType,
        targetLabelKey: merged.targetLabelKey || null,
        targetLabelValue: merged.targetLabelValue || null,
      });
    }
  }

  async deleteMapping(id: string, actorUserId?: string | null): Promise<void> {
    const dataSource = await getDataSource();
    const mapping = await dataSource.getRepository(SsoAssignmentMapping).findOneBy({ id });
    await this.deleteAssignmentsForMapping(dataSource, id);
    if (mapping) {
      await this.archiveDynamicEngineSetForMapping(dataSource, mapping);
    }
    await dataSource.getRepository(SsoAssignmentMapping).delete({ id });
    await recordSsoAssignmentMappingAudit(dataSource, {
      action: 'authz.sso_assignment_mapping.delete',
      actorUserId,
      mappingId: id,
    });
  }

  async testClaims(claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<{
    matchedMappings: Array<SsoAssignmentMappingView & { targetResourceId: string | null; targetResourceIds: Array<string | null> }>;
    assignments: Array<{ roleId: SsoEngineRoleId; resourceType: 'engine'; resourceId: string | null; mappingId: string }>;
  }> {
    const dataSource = await getDataSource();
    const mappings = await this.getMatchingMappings(claims, providerId, tenantId);
    const matchedMappings = [];
    const assignments = [];
    for (const mapping of mappings) {
      const targetResourceIds = await this.resolveTargetResourceIds(dataSource, mapping, tenantId);
      matchedMappings.push({
        ...toView(mapping),
        targetResourceId: targetResourceIds[0] ?? null,
        targetResourceIds,
      });
      for (const resourceId of targetResourceIds) {
        assignments.push({
          roleId: mapping.targetRoleId as SsoEngineRoleId,
          resourceType: 'engine' as const,
          resourceId,
          mappingId: mapping.id,
        });
      }
    }
    return {
      matchedMappings,
      assignments,
    };
  }

  async syncAssignmentsForUser(userId: string, claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> {
    const dataSource = await getDataSource();
    return this.syncAssignmentsForUserInStore(dataSource, userId, claims, providerId, tenantId);
  }

  async syncAssignmentsForUserWithManager(manager: EntityManager, userId: string, claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> {
    return this.syncAssignmentsForUserInStore(manager, userId, claims, providerId, tenantId);
  }

  private async syncAssignmentsForUserInStore(
    store: SsoAssignmentMappingStore,
    userId: string,
    claims: SsoClaims,
    providerId?: string,
    tenantId?: string | null
  ): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> {
    const mappings = await this.getCandidateMappings(store, providerId, tenantId);
    const assignmentRepo = store.getRepository(RbacRoleAssignment);
    let created = 0;
    let updated = 0;
    let removed = 0;
    const now = Date.now();

    for (const mapping of mappings) {
      const sourceRef = legacyAssignmentSourceRef(mapping);
      const platformSettingsAllowGrant = await this.platformSettingsAllowMappingGrant(store, mapping);
      const matches = platformSettingsAllowGrant && ssoClaimMatches(claims, mapping);
      const desiredAssignmentIds = new Set<string>();

      if (matches) {
        const targets = await this.resolveAssignmentTargets(store, mapping, tenantId);
        for (const target of targets) {
          const assignmentKey = canonicalRoleAssignmentKey({
            tenantId: normalizeTenantId(tenantId ?? mapping.tenantId),
            principalType: 'user',
            principalId: userId,
            roleId: mapping.targetRoleId,
            scopeType: target.scopeType,
            scopeId: target.scopeId,
            source: 'sso',
            sourceRef,
          });
          const legacyAssignmentKey = sourceRef === mapping.id
            ? assignmentKey
            : canonicalRoleAssignmentKey({
              tenantId: normalizeTenantId(tenantId ?? mapping.tenantId),
              principalType: 'user',
              principalId: userId,
              roleId: mapping.targetRoleId,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
              source: 'sso',
              sourceRef: mapping.id,
            });
          const findExistingAssignment = async (key: string): Promise<RbacRoleAssignment | null> => {
            return assignmentRepo.createQueryBuilder('assignment')
              .where('assignment.assignmentKey = :assignmentKey', { assignmentKey: key })
              .getOne();
          };
          const existing = await findExistingAssignment(assignmentKey)
            || (legacyAssignmentKey === assignmentKey ? null : await findExistingAssignment(legacyAssignmentKey));

          if (existing) {
            await assignmentRepo.update({ id: existing.id }, {
              principalType: 'user',
              principalId: userId,
              assignmentKey,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
              sourceMappingId: mapping.id,
              sourceRef,
              expiresAt: null,
              lastSeenAt: now,
              updatedAt: now,
            });
            await ssoEngineAccessSnapshotService.recordActiveGrant(store, {
              tenantId: tenantId ?? mapping.tenantId,
              providerId: providerId ?? mapping.providerId,
              mappingId: mapping.id,
              principalType: 'user',
              principalId: userId,
              roleId: mapping.targetRoleId,
              assignmentId: existing.id,
              resourceId: target.resourceId,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
              claims,
              details: {
                targetSelectorType: mapping.targetSelectorType,
                targetEngineId: mapping.targetEngineId,
                targetExternalEngineId: mapping.targetExternalEngineId,
                targetLabelKey: mapping.targetLabelKey,
                targetLabelValue: mapping.targetLabelValue,
              },
            });
            desiredAssignmentIds.add(existing.id);
            updated += 1;
          } else {
            const id = generateId();
            await assignmentRepo.insert({
              id,
              tenantId: normalizeTenantId(tenantId ?? mapping.tenantId),
              userId: null,
              principalType: 'user',
              principalId: userId,
              assignmentKey,
              roleId: mapping.targetRoleId,
              resourceType: null,
              resourceId: null,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
              source: 'sso',
              sourceMappingId: mapping.id,
              sourceRef,
              expiresAt: null,
              lastSeenAt: now,
              createdById: null,
              createdAt: now,
              updatedAt: now,
            });
            await recordSsoAssignmentAudit(store, {
              action: 'authz.sso_assignment.create',
              tenantId: tenantId ?? mapping.tenantId,
              assignmentId: id,
              userId,
              roleId: mapping.targetRoleId,
              resourceId: target.resourceId,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
              mappingId: mapping.id,
            });
            await ssoEngineAccessSnapshotService.recordActiveGrant(store, {
              tenantId: tenantId ?? mapping.tenantId,
              providerId: providerId ?? mapping.providerId,
              mappingId: mapping.id,
              principalType: 'user',
              principalId: userId,
              roleId: mapping.targetRoleId,
              assignmentId: id,
              resourceId: target.resourceId,
              scopeType: target.scopeType,
              scopeId: target.scopeId,
              claims,
              details: {
                targetSelectorType: mapping.targetSelectorType,
                targetEngineId: mapping.targetEngineId,
                targetExternalEngineId: mapping.targetExternalEngineId,
                targetLabelKey: mapping.targetLabelKey,
                targetLabelValue: mapping.targetLabelValue,
              },
            });
            desiredAssignmentIds.add(id);
            created += 1;
          }
        }
      }

      if (mapping.syncMode === 'authoritative' || !platformSettingsAllowGrant) {
        const sourceRefCriteria = assignmentSourceRefCriteria(sourceRef, mapping.id);
        const normalizedAssignmentTenantId = normalizeTenantId(tenantId ?? mapping.tenantId);
        const staleAssignments = await assignmentRepo.find({
          where: normalizedAssignmentTenantId
            ? [
              { tenantId: normalizedAssignmentTenantId, principalType: 'user', principalId: userId, source: 'sso', sourceRef: sourceRefCriteria },
              { tenantId: IsNull(), principalType: 'user', principalId: userId, source: 'sso', sourceRef: sourceRefCriteria },
            ]
            : { principalType: 'user', principalId: userId, source: 'sso', sourceRef: sourceRefCriteria },
        });
        const staleIds = staleAssignments
          .map((assignment) => assignment.id)
          .filter((id) => !desiredAssignmentIds.has(id));
        for (const staleAssignment of staleAssignments.filter((assignment) => staleIds.includes(assignment.id))) {
          await ssoEngineAccessSnapshotService.markAssignmentRemoved(store, staleAssignment, {
            status: platformSettingsAllowGrant ? 'removed_by_sso' : 'mapping_disabled',
            cleanupReason: platformSettingsAllowGrant
              ? (matches ? 'authoritative_target_no_longer_desired' : 'authoritative_claim_no_longer_matches')
              : 'platform_setting_disabled',
            details: {
              mappingId: mapping.id,
              syncMode: mapping.syncMode,
            },
          });
          await assignmentRepo.delete({ id: staleAssignment.id });
          await recordSsoAssignmentAudit(store, {
            action: 'authz.sso_assignment.delete',
            tenantId: staleAssignment.tenantId,
            assignmentId: staleAssignment.id,
            userId: staleAssignment.principalId || staleAssignment.userId || '',
            roleId: staleAssignment.roleId,
            resourceId: staleAssignment.scopeId ?? staleAssignment.resourceId,
            scopeType: staleAssignment.scopeType,
            scopeId: staleAssignment.scopeId,
            mappingId: mapping.id,
          });
          removed += 1;
        }
      }
    }

    return { created, updated, removed };
  }

  private async getMatchingMappings(claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<SsoAssignmentMapping[]> {
    const dataSource = await getDataSource();
    const mappings = await this.getCandidateMappings(dataSource, providerId, tenantId);
    const matchingMappings = [];
    for (const mapping of mappings) {
      if (ssoClaimMatches(claims, mapping) && await this.platformSettingsAllowMappingGrant(dataSource, mapping)) {
        matchingMappings.push(mapping);
      }
    }
    return matchingMappings;
  }

  private async getCandidateMappings(dataSource: SsoAssignmentMappingStore, providerId?: string, tenantId?: string | null): Promise<SsoAssignmentMapping[]> {
    const qb = dataSource.getRepository(SsoAssignmentMapping).createQueryBuilder('m')
      .where('m.isActive = :isActive', { isActive: true })
      .andWhere(providerId
        ? '(m.providerId IS NULL OR m.providerId = :providerId)'
        : 'm.providerId IS NULL',
        providerId ? { providerId } : {}
      )
      .orderBy('m.priority', 'DESC');
    addTenantScopeFilter(qb, 'm', tenantId);

    return qb.getMany();
  }

  private async resolveAssignmentTargets(
    dataSource: SsoAssignmentMappingStore,
    mapping: Pick<SsoAssignmentMapping, 'id' | 'tenantId' | 'providerId' | 'targetSelectorType' | 'targetEngineId' | 'targetExternalEngineId' | 'targetLabelKey' | 'targetLabelValue'>,
    tenantId?: string | null
  ): Promise<ResolvedAssignmentTarget[]> {
    if (mapping.targetSelectorType === 'all_engines' || mapping.targetSelectorType === 'engine_label') {
      const engineSetId = await this.reconcileDynamicEngineSetForMapping(dataSource, mapping, tenantId);
      return engineSetId
        ? [{ resourceType: 'engine', resourceId: null, scopeType: 'engine_set', scopeId: engineSetId }]
        : [];
    }

    const targetResourceIds = await this.resolveTargetResourceIds(dataSource, mapping, tenantId);
    return targetResourceIds.map((targetResourceId) => ({
      resourceType: 'engine',
      resourceId: targetResourceId,
      scopeType: 'engine',
      scopeId: targetResourceId,
    }));
  }

  private async resolveTargetResourceIds(
    dataSource: SsoAssignmentMappingStore,
    mapping: Pick<SsoAssignmentMapping, 'targetSelectorType' | 'targetEngineId' | 'targetExternalEngineId' | 'targetLabelKey' | 'targetLabelValue'>,
    tenantId?: string | null
  ): Promise<Array<string | null>> {
    if (mapping.targetSelectorType === 'all_engines') {
      return [null];
    }
    if (mapping.targetSelectorType === 'engine_id') {
      return mapping.targetEngineId ? [mapping.targetEngineId] : [];
    }
    if (mapping.targetSelectorType === 'external_engine_id') {
      if (!mapping.targetExternalEngineId) return [];
      const normalizedTenantId = normalizeTenantId(tenantId);
      const registration = await dataSource.getRepository(ExternalEngineRegistration).findOne({
        where: { externalId: mapping.targetExternalEngineId },
        select: ['engineId'],
      });
      if (registration) {
        const engine = await dataSource.getRepository(Engine).findOne({
          where: normalizedTenantId
            ? [
              { id: registration.engineId, tenantId: normalizedTenantId },
              { id: registration.engineId, tenantId: IsNull() },
            ]
            : { id: registration.engineId },
          select: ['id'],
        });
        return engine ? [registration.engineId] : [];
      }
      const engine = await dataSource.getRepository(Engine).findOne({
        where: normalizedTenantId
          ? [
            { externalId: mapping.targetExternalEngineId, tenantId: normalizedTenantId },
            { externalId: mapping.targetExternalEngineId, tenantId: IsNull() },
          ]
          : { externalId: mapping.targetExternalEngineId },
        select: ['id'],
      });
      return engine ? [engine.id] : [];
    }
    if (!mapping.targetLabelKey || !mapping.targetLabelValue) {
      return [];
    }
    const registrations = await dataSource.getRepository(ExternalEngineRegistration).find({
      select: ['engineId', 'labelsJson'],
    });
    const matchingRegistrationIds = registrations
      .filter((registration) => parseEngineLabels(registration.labelsJson)[mapping.targetLabelKey!] === mapping.targetLabelValue)
      .map((registration) => registration.engineId);
    if (matchingRegistrationIds.length > 0) {
      const normalizedTenantId = normalizeTenantId(tenantId);
      if (!normalizedTenantId) {
        return Array.from(new Set(matchingRegistrationIds));
      }
      const matchingEngines = await dataSource.getRepository(Engine).find({
        where: [
          { id: In(Array.from(new Set(matchingRegistrationIds))), tenantId: normalizedTenantId },
          { id: In(Array.from(new Set(matchingRegistrationIds))), tenantId: IsNull() },
        ],
        select: ['id'],
      });
      return matchingEngines.map((engine) => engine.id);
    }
    const normalizedTenantId = normalizeTenantId(tenantId);
    const engines = await dataSource.getRepository(Engine).find({
      where: normalizedTenantId
        ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }]
        : undefined,
      select: ['id', 'labelsJson'],
    });
    return engines
      .filter((engine) => parseEngineLabels(engine.labelsJson)[mapping.targetLabelKey!] === mapping.targetLabelValue)
      .map((engine) => engine.id);
  }

  private async reconcileDynamicEngineSetForMapping(
    dataSource: SsoAssignmentMappingStore,
    mapping: Pick<SsoAssignmentMapping, 'id' | 'tenantId' | 'providerId' | 'targetSelectorType' | 'targetLabelKey' | 'targetLabelValue'>,
    tenantId?: string | null
  ): Promise<string | null> {
    const selector = dynamicEngineSetSelectorForMapping(mapping);
    if (!selector) {
      await this.archiveDynamicEngineSetForMapping(dataSource, mapping, tenantId ?? mapping.tenantId);
      return null;
    }

    const normalizedTenantId = normalizeTenantId(tenantId ?? mapping.tenantId);
    const sourceRef = legacyAssignmentSourceRef(mapping);
    const sourceRefCriteria = assignmentSourceRefCriteria(sourceRef, mapping.id);
    const now = Date.now();
    const fingerprint = selectorFingerprint(selector);
    const selectorJson = stableJson(selector);
    const engineSetRepo = dataSource.getRepository(EngineSet);
    const existing = await engineSetRepo.findOne({
      where: normalizedTenantId
        ? { tenantId: normalizedTenantId, source: 'sso', sourceRef: sourceRefCriteria }
        : { tenantId: IsNull(), source: 'sso', sourceRef: sourceRefCriteria },
    });
    const engineSetId = existing?.id || generateId();
    const key = existing?.key || keyFromMappingId(mapping.id);
    const name = mapping.targetSelectorType === 'all_engines'
      ? `SSO mapping ${mapping.id} all engines`
      : `SSO mapping ${mapping.id} ${mapping.targetLabelKey}=${mapping.targetLabelValue}`;

    if (existing) {
      await engineSetRepo.update({ id: existing.id }, {
        key,
        name,
        description: 'Managed by SSO engine assignment mapping.',
        selectorJson,
        selectorFingerprint: fingerprint,
        sourceRef,
        isArchived: false,
        materializationStatus: 'pending',
        materializationError: null,
        updatedAt: now,
      });
    } else {
      await engineSetRepo.insert({
        id: engineSetId,
        tenantId: normalizedTenantId,
        key,
        engineSetKeyIdentity: engineSetKeyIdentity(normalizedTenantId, key),
        name,
        description: 'Managed by SSO engine assignment mapping.',
        selectorJson,
        selectorFingerprint: fingerprint,
        source: 'sso',
        sourceRef,
        isArchived: false,
        createdById: null,
        lastMaterializedAt: null,
        materializationStatus: 'pending',
        materializationError: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await this.materializeDynamicEngineSet(dataSource, {
      id: engineSetId,
      tenantId: normalizedTenantId,
      key,
      selector,
      selectorFingerprint: fingerprint,
      sourceRef,
    });
    return engineSetId;
  }

  private async archiveDynamicEngineSetForMapping(
    dataSource: SsoAssignmentMappingStore,
    mapping: Pick<SsoAssignmentMapping, 'id' | 'providerId'>,
    tenantId?: string | null
  ): Promise<void> {
    const normalizedTenantId = normalizeTenantId(tenantId);
    const sourceRef = legacyAssignmentSourceRef(mapping);
    const sourceRefCriteria = assignmentSourceRefCriteria(sourceRef, mapping.id);
    const engineSetRepo = dataSource.getRepository(EngineSet);
    const engineSet = await engineSetRepo.findOne({
      where: normalizedTenantId
        ? { tenantId: normalizedTenantId, source: 'sso', sourceRef: sourceRefCriteria }
        : { source: 'sso', sourceRef: sourceRefCriteria },
    });
    if (!engineSet) return;
    await engineSetRepo.update({ id: engineSet.id }, {
      isArchived: true,
      materializationStatus: 'archived',
      updatedAt: Date.now(),
    });
    await dataSource.getRepository(EngineSetMaterialization).delete({ engineSetId: engineSet.id });
  }

  private async materializeDynamicEngineSet(
    dataSource: SsoAssignmentMappingStore,
    engineSet: {
      id: string;
      tenantId: string | null;
      key: string;
      selector: DynamicEngineSetSelector;
      selectorFingerprint: string;
      sourceRef: string;
    }
  ): Promise<void> {
    const now = Date.now();
    const materializationRepo = dataSource.getRepository(EngineSetMaterialization);
    const engineSetRepo = dataSource.getRepository(EngineSet);
    try {
      const matches = await this.resolveDynamicEngineSetMatches(dataSource, engineSet.selector, engineSet.tenantId);
      const existing = await materializationRepo.find({ where: { engineSetId: engineSet.id } });
      const existingByEngineId = new Map(existing.map((row) => [row.engineId, row]));
      const matchedEngineIds = new Set(matches.map((match) => match.engineId));

      for (const match of matches) {
        const matchedByJson = stableJson(match.matchedBy);
        const lineageJson = stableJson({
          engineSetId: engineSet.id,
          engineSetKey: engineSet.key,
          selector: engineSet.selector,
          selectorFingerprint: engineSet.selectorFingerprint,
          matchedAt: now,
          source: 'sso',
          sourceRef: engineSet.sourceRef,
          labels: match.labels,
        });
        const existingRow = existingByEngineId.get(match.engineId);
        if (existingRow) {
          await materializationRepo.update({ id: existingRow.id }, {
            tenantId: engineSet.tenantId,
            selectorFingerprint: engineSet.selectorFingerprint,
            matchedByJson,
            lineageJson,
            source: 'sso',
            sourceRef: engineSet.sourceRef,
            lastSeenAt: now,
            updatedAt: now,
          });
        } else {
          await materializationRepo.insert({
            id: generateId(),
            tenantId: engineSet.tenantId,
            engineSetId: engineSet.id,
            engineId: match.engineId,
            selectorFingerprint: engineSet.selectorFingerprint,
            matchedByJson,
            lineageJson,
            source: 'sso',
            sourceRef: engineSet.sourceRef,
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const staleIds = existing
        .filter((row) => !matchedEngineIds.has(row.engineId))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await materializationRepo.delete({ id: In(staleIds) });
      }

      await engineSetRepo.update({ id: engineSet.id }, {
        selectorFingerprint: engineSet.selectorFingerprint,
        lastMaterializedAt: now,
        materializationStatus: 'ok',
        materializationError: null,
        updatedAt: now,
      });
    } catch (error: any) {
      await engineSetRepo.update({ id: engineSet.id }, {
        materializationStatus: 'failed',
        materializationError: error?.message || 'SSO Engine Set materialization failed',
        updatedAt: Date.now(),
      });
      throw error;
    }
  }

  private async resolveDynamicEngineSetMatches(
    dataSource: SsoAssignmentMappingStore,
    selector: DynamicEngineSetSelector,
    tenantId?: string | null
  ): Promise<Array<{ engineId: string; labels: Record<string, string>; matchedBy: Record<string, unknown> }>> {
    const normalizedTenantId = normalizeTenantId(tenantId);
    const engines = await dataSource.getRepository(Engine).find({
      where: normalizedTenantId
        ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }]
        : undefined,
      select: ['id', 'labelsJson', 'externalId', 'lifecycleStatus'],
    });
    const registrations = engines.length > 0
      ? await dataSource.getRepository(ExternalEngineRegistration).find({
        where: { engineId: In(engines.map((engine) => engine.id)) },
        select: ['engineId', 'labelsJson', 'externalId'],
      })
      : [];
    const registrationByEngineId = new Map(registrations.map((registration) => [registration.engineId, registration]));
    const matches: Array<{ engineId: string; labels: Record<string, string>; matchedBy: Record<string, unknown> }> = [];

    for (const engine of engines) {
      if (engine.lifecycleStatus === 'decommissioned') continue;
      const registration = registrationByEngineId.get(engine.id);
      const labels = {
        ...parseEngineLabels(engine.labelsJson),
        ...parseEngineLabels(registration?.labelsJson),
      };
      if (selector.mode === 'labels') {
        const labelEntries = Object.entries(selector.labels);
        if (!labelEntries.every(([key, value]) => labels[key] === value)) {
          continue;
        }
      }
      matches.push({
        engineId: engine.id,
        labels,
        matchedBy: selector.mode === 'labels'
          ? { mode: selector.mode, labels: selector.labels, labelMatch: selector.labelMatch }
          : { mode: selector.mode, engineId: engine.id, externalId: registration?.externalId || engine.externalId || null },
      });
    }

    return matches.sort((left, right) => left.engineId.localeCompare(right.engineId));
  }

  private async deleteAssignmentsForMapping(dataSource: SsoAssignmentMappingStore, mappingId: string): Promise<void> {
    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
    // `sourceRef` was the only lineage written by older releases. Keep that
    // fallback until every deployed database has received the backfill below.
    const mappingAssignments = [
      { source: 'sso', sourceMappingId: mappingId },
      { source: 'sso', sourceMappingId: IsNull(), sourceRef: mappingId },
    ];
    const assignments = await assignmentRepo.find({
      where: mappingAssignments,
    });
    await assignmentRepo.delete(mappingAssignments);
    for (const assignment of assignments) {
      await ssoEngineAccessSnapshotService.markAssignmentRemoved(dataSource, assignment, {
        status: 'mapping_disabled',
        cleanupReason: 'mapping_deleted',
        details: { mappingId },
      });
      await recordSsoAssignmentAudit(dataSource, {
        tenantId: assignment.tenantId,
        action: 'authz.sso_assignment.delete',
        assignmentId: assignment.id,
        userId: assignment.principalId || assignment.userId || '',
        roleId: assignment.roleId,
        resourceId: assignment.scopeId ?? assignment.resourceId,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        mappingId,
      });
    }
    await ssoEngineAccessSnapshotService.markMappingRemoved(dataSource, mappingId, 'mapping_disabled', 'mapping_deleted');
  }

  private async requireMappingRiskAcknowledgement(
    dataSource: SsoAssignmentMappingStore,
    input: SsoAssignmentMappingInput
  ): Promise<SsoAssignmentMappingRiskReason[]> {
    const riskReasons = await this.getMappingRiskReasons(dataSource, input);
    const acknowledgementRequired = riskReasons.some(mappingRiskReasonRequiresAcknowledgement);
    if (acknowledgementRequired && input.riskAcknowledged !== true) {
      throw new Error('High-risk SSO assignment mapping requires acknowledgement');
    }
    return riskReasons;
  }

  private async getMappingRiskReasons(
    dataSource: SsoAssignmentMappingStore,
    input: Pick<SsoAssignmentMappingInput, 'targetSelectorType' | 'targetRoleId' | 'claimOperator' | 'isActive'>
  ): Promise<SsoAssignmentMappingRiskReason[]> {
    const riskReasons = getStaticMappingRiskReasons(input);
    const customRoleRiskReasons = await this.getSensitiveCustomRoleRiskReasons(dataSource, input.targetRoleId, input.isActive);
    for (const riskReason of customRoleRiskReasons) {
      if (!riskReasons.includes(riskReason)) {
        riskReasons.push(riskReason);
      }
    }
    return riskReasons;
  }

  private async getSensitiveCustomRoleRiskReasons(
    dataSource: SsoAssignmentMappingStore,
    targetRoleId?: string | null,
    isActive?: boolean | null
  ): Promise<SsoAssignmentMappingRiskReason[]> {
    if (isActive === false || !targetRoleId || targetRoleId.startsWith('system.')) {
      return [];
    }

    const rolePermissions = await dataSource.getRepository(RbacRolePermission).find({
      where: { roleId: targetRoleId },
      select: ['permissionId'],
    });
    const permissionIds = new Set(rolePermissions.map((rolePermission) => rolePermission.permissionId));
    const riskReasons: SsoAssignmentMappingRiskReason[] = [];
    if (
      permissionIds.has(EnginePermissions.SECRETS_VIEW) ||
      permissionIds.has(EnginePermissions.SECRETS_MANAGE)
    ) {
      riskReasons.push('engine_secret_permission');
    }
    if (permissionIds.has(PlatformPermissions.AUDIT_UNREDACTED_VIEW)) {
      riskReasons.push('unredacted_audit_permission');
    }
    if (
      permissionIds.has(PlatformPermissions.USERS_PERMANENT_DELETE) ||
      Array.from(permissionIds).some((permissionId) => permissionId.endsWith(':permanent-delete'))
    ) {
      riskReasons.push('permanent_delete_permission');
    }
    return riskReasons;
  }

  private async validateMappingInput(dataSource: SsoAssignmentMappingStore, input: SsoAssignmentMappingInput): Promise<void> {
    if (!input.claimKey?.trim()) {
      throw new Error('claimKey is required');
    }
    if (ssoClaimOperatorRequiresValue(input.claimOperator) && !input.claimValue?.trim()) {
      throw new Error('claimValue is required');
    }
    await this.validateTargetRole(dataSource, input.targetRoleId, input.tenantId);
    if (input.targetSelectorType === 'engine_id') {
      if (!input.targetEngineId) {
        throw new Error('targetEngineId is required for engine_id selector');
      }
      if (input.isActive === false) {
        return;
      }
      const normalizedTenantId = normalizeTenantId(input.tenantId);
      const engine = await dataSource.getRepository(Engine).findOne({
        where: normalizedTenantId
          ? [
            { id: input.targetEngineId, tenantId: normalizedTenantId },
            { id: input.targetEngineId, tenantId: IsNull() },
          ]
          : { id: input.targetEngineId },
        select: ['id'],
      });
      if (!engine) {
        throw new Error('Target engine does not exist');
      }
    } else if (input.targetSelectorType === 'external_engine_id') {
      if (!input.targetExternalEngineId) {
        throw new Error('targetExternalEngineId is required for external_engine_id selector');
      }
    } else if (input.targetSelectorType === 'engine_label') {
      if (!input.targetLabelKey || !input.targetLabelValue) {
        throw new Error('targetLabelKey and targetLabelValue are required for engine_label selector');
      }
    }
  }

  private async validatePlatformRiskSettings(dataSource: SsoAssignmentMappingStore, input: SsoAssignmentMappingInput): Promise<void> {
    const disabledReasons = await this.getDisabledPlatformRiskReasons(dataSource, input);
    if (disabledReasons.length === 0) {
      return;
    }
    throw new Error(`High-risk SSO assignment mappings are disabled by platform settings: ${disabledReasons.join(', ')}`);
  }

  async getDisabledPlatformRiskReasonsForMapping(
    dataSource: SsoAssignmentMappingStore,
    mapping: { targetSelectorType: string; targetRoleId?: string | null; claimOperator?: SsoClaimOperator | string | null; isActive?: boolean | null }
  ): Promise<string[]> {
    return this.getDisabledPlatformRiskReasons(dataSource, mapping);
  }

  private async platformSettingsAllowMappingGrant(
    dataSource: SsoAssignmentMappingStore,
    mapping: { targetSelectorType: string; targetRoleId?: string | null; claimOperator?: SsoClaimOperator | string | null; isActive?: boolean | null }
  ): Promise<boolean> {
    return (await this.getDisabledPlatformRiskReasons(dataSource, mapping)).length === 0;
  }

  private async getDisabledPlatformRiskReasons(
    dataSource: SsoAssignmentMappingStore,
    mapping: { targetSelectorType: string; targetRoleId?: string | null; claimOperator?: SsoClaimOperator | string | null; isActive?: boolean | null }
  ): Promise<string[]> {
    if (mapping.isActive === false) return [];
    const customRoleRiskReasons = await this.getSensitiveCustomRoleRiskReasons(dataSource, mapping.targetRoleId, mapping.isActive);
    if (
      mapping.targetSelectorType !== 'all_engines' &&
      mapping.targetRoleId !== SYSTEM_ROLE_IDS.ENGINE_OWNER &&
      mapping.targetRoleId !== SYSTEM_ROLE_IDS.ENGINE_DELEGATE &&
      !ssoClaimOperatorIsRegex(mapping.claimOperator) &&
      customRoleRiskReasons.length === 0
    ) {
      return [];
    }

    const settings = await dataSource.getRepository(PlatformSettings).findOneBy({ id: 'default' });
    const disabledReasons: string[] = [];
    if (mapping.targetSelectorType === 'all_engines' && !((settings as any)?.ssoAllEnginesAssignmentMappingsEnabled ?? true)) {
      disabledReasons.push('all_engines_selector');
    }
    if (mapping.targetRoleId === SYSTEM_ROLE_IDS.ENGINE_OWNER && !((settings as any)?.ssoEngineOwnerAssignmentMappingsEnabled ?? false)) {
      disabledReasons.push('engine_owner_role');
    }
    if (mapping.targetRoleId === SYSTEM_ROLE_IDS.ENGINE_DELEGATE && !((settings as any)?.ssoEngineDelegateAssignmentMappingsEnabled ?? false)) {
      disabledReasons.push('engine_delegate_role');
    }
    if (ssoClaimOperatorIsRegex(mapping.claimOperator) && !((settings as any)?.ssoRegexClaimMappingsEnabled ?? false)) {
      disabledReasons.push('regex_claim_operator');
    }
    if (customRoleRiskReasons.includes('engine_secret_permission') && !((settings as any)?.ssoSecretViewMappingsEnabled ?? false)) {
      disabledReasons.push('engine_secret_permission');
    }
    if (customRoleRiskReasons.includes('unredacted_audit_permission') && !((settings as any)?.ssoUnredactedAuditMappingsEnabled ?? false)) {
      disabledReasons.push('unredacted_audit_permission');
    }
    if (customRoleRiskReasons.includes('permanent_delete_permission') && !((settings as any)?.ssoPermanentDeleteMappingsEnabled ?? false)) {
      disabledReasons.push('permanent_delete_permission');
    }
    return disabledReasons;
  }

  private async validateTargetRole(dataSource: SsoAssignmentMappingStore, targetRoleId: string, tenantId?: string | null): Promise<void> {
    if (ALLOWED_SSO_ENGINE_ROLE_IDS.has(targetRoleId)) {
      return;
    }

    if (targetRoleId === SYSTEM_ROLE_IDS.ENGINE_OWNER || targetRoleId === SYSTEM_ROLE_IDS.ENGINE_DELEGATE) {
      return;
    }

    if (targetRoleId.startsWith('system.')) {
      throw new Error('SSO engine assignments can only target system operator/deployer, explicitly enabled system owner/delegate, or assignable custom engine roles');
    }

    const role = await dataSource.getRepository(RbacRole).findOne({
      where: { id: targetRoleId },
      select: ['id', 'tenantId', 'scope', 'kind', 'isAssignable', 'isArchived'],
    });

    const normalizedTenantId = normalizeTenantId(tenantId);
    if (
      !role ||
      (normalizedTenantId && role.tenantId && role.tenantId !== normalizedTenantId) ||
      role.scope !== 'engine' ||
      role.kind !== 'custom' ||
      !role.isAssignable ||
      role.isArchived
    ) {
      throw new Error('SSO engine assignments can only target system operator/deployer, explicitly enabled system owner/delegate, or assignable custom engine roles');
    }
  }
}

export const ssoAssignmentMappingService = new SsoAssignmentMappingServiceClass();
