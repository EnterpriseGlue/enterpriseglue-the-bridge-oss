import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { SsoAssignmentMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoAssignmentMapping.js';
import { SsoClaimsMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoClaimsMapping.js';
import { SsoGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoGroupMapping.js';
import { SYSTEM_ROLE_IDS } from './permissions.js';
import { authorizationAttributeEntitlementId } from './IdentityProviderAdapter.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { IsNull } from 'typeorm';
import { LEGACY_MAPPING_CONVERSION_AUDIT_ACTION, type LegacyMappingConversionFamily } from './LegacyMappingConversionAudit.js';
import type {
  LegacyMappingCoverageItem as SharedLegacyMappingCoverageItem,
  LegacyMappingCoverageStatus as SharedLegacyMappingCoverageStatus,
  LegacyMappingRetirementReadiness as SharedLegacyMappingRetirementReadiness,
  LegacyMappingRetirementResult as SharedLegacyMappingRetirementResult,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

export type LegacyMappingCoverageStatus = SharedLegacyMappingCoverageStatus;
export type LegacyMappingCoverageItem = SharedLegacyMappingCoverageItem;
export type LegacyMappingRetirementReadiness = SharedLegacyMappingRetirementReadiness;
export type LegacyMappingRetirementResult = SharedLegacyMappingRetirementResult;

type LegacyClaimMapping = {
  providerId?: string | null;
  claimType: string;
  claimKey: string;
  claimOperator: string | null;
  claimValue: string;
};

function normalizeEmailDomainValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('*@')) return normalized.slice(2);
  const atIndex = normalized.lastIndexOf('@');
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : normalized;
}

function authorizationAttributeKeys(provider: IdentityProvider | undefined): string[] {
  if (!provider) return [];
  try {
    const configured = JSON.parse(provider.configurationJson).authorizationAttributeKeys;
    return Array.isArray(configured)
      ? configured.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}

function replacementEntitlement(mapping: LegacyClaimMapping, candidateProvider: IdentityProvider | undefined): {
  entitlementType: string;
  externalId: string | null;
  matchOperator: string;
} | null {
  const matchOperator = mapping.claimOperator === null || mapping.claimOperator === 'equals'
    ? 'exact'
    : mapping.claimOperator === 'contains'
      ? 'contains'
      : mapping.claimOperator === 'exists'
        ? 'exists'
        : null;
  if (matchOperator && ['group', 'role'].includes(mapping.claimType)) {
    return {
      entitlementType: mapping.claimType,
      externalId: matchOperator === 'exists' ? null : mapping.claimValue.trim(),
      matchOperator,
    };
  }
  if (mapping.claimType === 'email_domain') {
    const exactDomain = mapping.claimOperator === 'equals'
      ? normalizeEmailDomainValue(mapping.claimValue)
      : mapping.claimOperator === null && mapping.claimValue.trim().startsWith('*@')
        ? normalizeEmailDomainValue(mapping.claimValue)
        : '';
    return exactDomain ? { entitlementType: 'attribute', externalId: `email_domain:${exactDomain}`, matchOperator: 'exact' } : null;
  }
  if (
    mapping.claimType === 'custom'
    && mapping.claimOperator === 'equals'
    && mapping.claimKey.trim()
    && mapping.claimValue.trim()
    && authorizationAttributeKeys(candidateProvider).includes(mapping.claimKey.trim())
  ) {
    return {
      entitlementType: 'attribute',
      externalId: authorizationAttributeEntitlementId(mapping.claimKey.trim(), mapping.claimValue.trim()),
      matchOperator: 'exact',
    };
  }
  return null;
}

function matchShape(mapping: LegacyClaimMapping, candidate: IdentityEntitlementMapping, candidateProvider: IdentityProvider | undefined): boolean {
  const expected = replacementEntitlement(mapping, candidateProvider);
  if (!expected) return false;
  return candidate.isActive
    && candidate.entitlementType === expected.entitlementType
    && candidate.matchOperator === expected.matchOperator
    && candidate.externalId === expected.externalId;
}

function unsupportedReason(mapping: LegacyClaimMapping, providersById: Map<string, IdentityProvider>, family: LegacyMappingCoverageItem['family']): string | null {
  if (replacementEntitlement(mapping, undefined)) return null;
  if (mapping.claimType === 'custom' && mapping.claimOperator === 'equals') {
    const providers = mapping.providerId
      ? [providersById.get(mapping.providerId)].filter((provider): provider is IdentityProvider => Boolean(provider))
      : Array.from(providersById.values());
    if (!providers.some((provider) => authorizationAttributeKeys(provider).includes(mapping.claimKey.trim()))) {
      return 'Exact custom claims require the replacement provider to allowlist the claim key before retirement can be verified.';
    }
    return null;
  }
  if (mapping.claimType === 'email_domain') return 'Only exact email-domain mappings can be represented by the provider-neutral email-domain attribute.';
  if (!['group', 'role'].includes(mapping.claimType)) return 'This claim shape requires an explicit provider-neutral design.';
  if (!([null, 'equals', 'contains', 'exists'] as Array<string | null>).includes(mapping.claimOperator)) return 'Negated, multi-value, wildcard, and regex claim operators require an explicit provider-neutral design.';
  if (family === 'engine_assignment') return null;
  return null;
}

class LegacyMappingCoverageService {
  async getCoverage(tenantId?: string | null): Promise<LegacyMappingCoverageItem[]> {
    const dataSource = await getDataSource();
    const normalizedTenantId = tenantId?.trim() || null;
    const [platformMappings, groupMappings, assignmentMappings, identityMappings, providers, assignments, verificationEvents, conversionEvents] = await Promise.all([
      dataSource.getRepository(SsoClaimsMapping).find({ where: { isActive: true } }),
      dataSource.getRepository(SsoGroupMapping).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId, isActive: true }, { tenantId: IsNull(), isActive: true }] : { tenantId: IsNull(), isActive: true } as any }),
      dataSource.getRepository(SsoAssignmentMapping).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId, isActive: true }, { tenantId: IsNull(), isActive: true }] : { tenantId: IsNull(), isActive: true } as any }),
      dataSource.getRepository(IdentityEntitlementMapping).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : { tenantId: IsNull() } as any }),
      dataSource.getRepository(IdentityProvider).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : { tenantId: IsNull() } as any }),
      dataSource.getRepository(RbacRoleAssignment).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : { tenantId: IsNull() } as any }),
      dataSource.getRepository(AuditLog).find({ where: normalizedTenantId ? { tenantId: normalizedTenantId, action: 'authz.legacy_mapping_coverage.verify' } : { tenantId: IsNull(), action: 'authz.legacy_mapping_coverage.verify' }, order: { createdAt: 'DESC' } }),
      dataSource.getRepository(AuditLog).find({ where: normalizedTenantId ? { tenantId: normalizedTenantId, action: LEGACY_MAPPING_CONVERSION_AUDIT_ACTION } : { tenantId: IsNull(), action: LEGACY_MAPPING_CONVERSION_AUDIT_ACTION }, order: { createdAt: 'DESC' } }),
    ]);
    const providersById = new Map(providers.map((provider) => [provider.id, provider]));

    const verificationByKey = new Map<string, LegacyMappingCoverageItem['verification']>();
    for (const event of verificationEvents) {
      try {
        const details = JSON.parse(event.details || '{}') as { legacyMappingId?: string; family?: LegacyMappingCoverageItem['family']; candidateIdentityMappingId?: string; note?: string };
        if (!details.legacyMappingId || !details.family || !details.candidateIdentityMappingId) continue;
        const key = `${details.family}:${details.legacyMappingId}`;
        if (!verificationByKey.has(key)) verificationByKey.set(key, { candidateIdentityMappingId: details.candidateIdentityMappingId, verifiedById: event.userId, verifiedAt: event.createdAt, note: details.note || '' });
      } catch { /* A malformed historic audit row must not block diagnostics. */ }
    }
    const conversionIdentityMappingIdsByKey = new Map<string, Set<string>>();
    for (const event of conversionEvents) {
      try {
        const details = JSON.parse(event.details || '{}') as { legacyMappingId?: string; family?: LegacyMappingConversionFamily; identityMappingId?: string };
        if (!details.legacyMappingId || !details.family || !details.identityMappingId) continue;
        const key = `${details.family}:${details.legacyMappingId}`;
        const mappingIds = conversionIdentityMappingIdsByKey.get(key) || new Set<string>();
        mappingIds.add(details.identityMappingId);
        conversionIdentityMappingIdsByKey.set(key, mappingIds);
      } catch { /* A malformed historic audit row must not block diagnostics. */ }
    }

    const convertedCandidates = (family: LegacyMappingConversionFamily, legacyMappingId: string, candidates: IdentityEntitlementMapping[]): IdentityEntitlementMapping[] => {
      const recordedIds = conversionIdentityMappingIdsByKey.get(`${family}:${legacyMappingId}`);
      return recordedIds ? candidates.filter((candidate) => recordedIds.has(candidate.id)) : candidates;
    };

    const items: LegacyMappingCoverageItem[] = [];
    for (const mapping of platformMappings) {
      const unsupported = unsupportedReason(mapping, providersById, 'platform_role');
      if (unsupported) { items.push({ id: mapping.id, family: 'platform_role', status: 'manual_redesign_required', reason: unsupported, candidateIdentityMappingIds: [], verification: null }); continue; }
      const roleId = mapping.targetRole === 'admin' ? SYSTEM_ROLE_IDS.PLATFORM_ADMIN : SYSTEM_ROLE_IDS.PLATFORM_USER;
      const candidates = convertedCandidates('platform_role', mapping.id, identityMappings.filter((candidate) => candidate.tenantId === null && matchShape(mapping, candidate, providersById.get(candidate.providerId)) && assignments.some((assignment) => assignment.principalType === 'group' && assignment.principalId === candidate.targetGroupId && assignment.roleId === roleId && assignment.scopeType === 'platform')));
      items.push({ id: mapping.id, family: 'platform_role', status: candidates.length ? 'replacement_candidate' : 'no_replacement_candidate', reason: candidates.length ? 'A matching provider-neutral group grant exists; verify representative sign-in before retirement.' : 'No matching provider-neutral group grant was found.', candidateIdentityMappingIds: candidates.map((candidate) => candidate.id), verification: verificationByKey.get(`platform_role:${mapping.id}`) || null });
    }
    for (const mapping of groupMappings) {
      const unsupported = unsupportedReason(mapping, providersById, 'group');
      if (unsupported) { items.push({ id: mapping.id, family: 'group', status: 'manual_redesign_required', reason: unsupported, candidateIdentityMappingIds: [], verification: null }); continue; }
      const candidates = convertedCandidates('group', mapping.id, identityMappings.filter((candidate) => candidate.targetGroupId === mapping.targetGroupId && matchShape(mapping, candidate, providersById.get(candidate.providerId))));
      items.push({ id: mapping.id, family: 'group', status: candidates.length ? 'replacement_candidate' : 'no_replacement_candidate', reason: candidates.length ? 'A matching provider-neutral group mapping exists; verify representative sign-in before retirement.' : 'No matching provider-neutral group mapping was found.', candidateIdentityMappingIds: candidates.map((candidate) => candidate.id), verification: verificationByKey.get(`group:${mapping.id}`) || null });
    }
    for (const mapping of assignmentMappings) {
      if (mapping.targetSelectorType !== 'engine_id' || !mapping.targetEngineId) { items.push({ id: mapping.id, family: 'engine_assignment', status: 'manual_redesign_required', reason: 'Dynamic engine selectors require an explicit Engine Set and group assignment.', candidateIdentityMappingIds: [], verification: null }); continue; }
      const unsupported = unsupportedReason(mapping, providersById, 'engine_assignment');
      if (unsupported) { items.push({ id: mapping.id, family: 'engine_assignment', status: 'manual_redesign_required', reason: unsupported, candidateIdentityMappingIds: [], verification: null }); continue; }
      const candidates = convertedCandidates('engine_assignment', mapping.id, identityMappings.filter((candidate) => matchShape(mapping, candidate, providersById.get(candidate.providerId)) && assignments.some((assignment) => assignment.principalType === 'group' && assignment.principalId === candidate.targetGroupId && assignment.roleId === mapping.targetRoleId && assignment.scopeType === 'engine' && assignment.scopeId === mapping.targetEngineId)));
      items.push({ id: mapping.id, family: 'engine_assignment', status: candidates.length ? 'replacement_candidate' : 'no_replacement_candidate', reason: candidates.length ? 'A matching provider-neutral exact-engine group grant exists; verify engine access before retirement.' : 'No matching provider-neutral exact-engine group grant was found.', candidateIdentityMappingIds: candidates.map((candidate) => candidate.id), verification: verificationByKey.get(`engine_assignment:${mapping.id}`) || null });
    }
    return items;
  }

  async verifyReplacement(input: { tenantId?: string | null; legacyMappingId: string; family: LegacyMappingCoverageItem['family']; candidateIdentityMappingId: string; actorId: string; note: string }): Promise<void> {
    const tenantId = input.tenantId?.trim() || null;
    const note = input.note.trim();
    if (!note) throw Errors.validation('Verification note is required');
    const coverage = await this.getCoverage(tenantId);
    const item = coverage.find((candidate) => candidate.id === input.legacyMappingId && candidate.family === input.family);
    if (!item || item.status !== 'replacement_candidate' || !item.candidateIdentityMappingIds.includes(input.candidateIdentityMappingId)) throw Errors.validation('The selected provider-neutral mapping is not a current replacement candidate');
    const dataSource = await getDataSource();
    await dataSource.getRepository(AuditLog).insert({ id: generateId(), tenantId, userId: input.actorId, action: 'authz.legacy_mapping_coverage.verify', resourceType: 'sso_mapping', resourceId: input.legacyMappingId, ipAddress: null, userAgent: null, details: JSON.stringify({ legacyMappingId: input.legacyMappingId, family: input.family, candidateIdentityMappingId: input.candidateIdentityMappingId, note }), createdAt: Date.now() });
  }

  async getRetirementReadiness(tenantId?: string | null): Promise<LegacyMappingRetirementReadiness> {
    const coverage = await this.getCoverage(tenantId);
    const blockers = coverage.flatMap((item) => {
      if (item.status !== 'replacement_candidate') return [{ id: item.id, family: item.family, reason: item.reason }];
      if (!item.verification) return [{ id: item.id, family: item.family, reason: 'A current replacement candidate exists but has not been verified.' }];
      if (!item.candidateIdentityMappingIds.includes(item.verification.candidateIdentityMappingId)) return [{ id: item.id, family: item.family, reason: 'Recorded verification no longer matches a current replacement candidate.' }];
      return [];
    });
    return { ready: blockers.length === 0, activeLegacyMappingCount: coverage.length, verifiedReplacementCount: coverage.length - blockers.length, blockers };
  }

  async retireLegacyMappings(tenantId?: string | null, actorId?: string | null): Promise<LegacyMappingRetirementResult> {
    const normalizedTenantId = tenantId?.trim() || null;
    const readiness = await this.getRetirementReadiness(normalizedTenantId);
    if (!readiness.ready) throw Errors.forbidden('Legacy mapping retirement is blocked until every active mapping has a current verified replacement');
    if (normalizedTenantId && readiness.activeLegacyMappingCount > 0) {
      const coverage = await this.getCoverage(normalizedTenantId);
      if (coverage.some((item) => item.family === 'platform_role')) {
        throw Errors.forbidden('Globally scoped platform-role mappings must be retired from global platform scope');
      }
    }
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const now = Date.now();
      const platform = normalizedTenantId === null
        ? await manager.getRepository(SsoClaimsMapping).update({ isActive: true }, { isActive: false, updatedAt: now })
        : { affected: 0 };
      const tenantWhere = normalizedTenantId ? [{ tenantId: normalizedTenantId, isActive: true }, { tenantId: IsNull(), isActive: true }] : { tenantId: IsNull(), isActive: true };
      const groups = await manager.getRepository(SsoGroupMapping).update(tenantWhere as any, { isActive: false, updatedAt: now });
      const engines = await manager.getRepository(SsoAssignmentMapping).update(tenantWhere as any, { isActive: false, updatedAt: now });
      const result = { platformRoleMappingsDisabled: platform.affected || 0, groupMappingsDisabled: groups.affected || 0, engineAssignmentMappingsDisabled: engines.affected || 0 };
      await manager.getRepository(AuditLog).insert({ id: generateId(), tenantId: normalizedTenantId, userId: actorId || null, action: 'authz.legacy_mapping_retirement.disable', resourceType: 'platform', resourceId: null, ipAddress: null, userAgent: null, details: JSON.stringify({ readiness, result, rollback: 'Re-enable individual legacy mappings through their existing Active control if rollback is required.' }), createdAt: now });
      return result;
    });
  }
}

export const legacyMappingCoverageService = new LegacyMappingCoverageService();
