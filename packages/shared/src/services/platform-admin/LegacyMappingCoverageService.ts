import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { SsoAssignmentMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoAssignmentMapping.js';
import { SsoClaimsMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoClaimsMapping.js';
import { SsoGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoGroupMapping.js';
import { SYSTEM_ROLE_IDS } from './permissions.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { IsNull } from 'typeorm';

export type LegacyMappingCoverageStatus = 'replacement_candidate' | 'manual_redesign_required' | 'no_replacement_candidate';
export interface LegacyMappingCoverageItem {
  id: string;
  family: 'platform_role' | 'group' | 'engine_assignment';
  status: LegacyMappingCoverageStatus;
  reason: string;
  candidateIdentityMappingIds: string[];
  verification: { candidateIdentityMappingId: string; verifiedById: string | null; verifiedAt: number; note: string } | null;
}

export interface LegacyMappingRetirementReadiness {
  ready: boolean;
  activeLegacyMappingCount: number;
  verifiedReplacementCount: number;
  blockers: Array<{ id: string; family: LegacyMappingCoverageItem['family']; reason: string }>;
}

function matchShape(mapping: { claimType: string; claimOperator: string | null; claimValue: string }, candidate: IdentityEntitlementMapping): boolean {
  const matchOperator = mapping.claimOperator === null || mapping.claimOperator === 'equals'
    ? 'exact'
    : mapping.claimOperator === 'contains'
      ? 'contains'
      : mapping.claimOperator === 'exists'
        ? 'exists'
        : null;
  if (!matchOperator || !['group', 'role'].includes(mapping.claimType)) return false;
  return candidate.isActive
    && candidate.entitlementType === mapping.claimType
    && candidate.matchOperator === matchOperator
    && (matchOperator === 'exists' ? candidate.externalId === null : candidate.externalId === mapping.claimValue.trim());
}

function unsupportedReason(mapping: { claimType: string; claimOperator: string | null }, family: LegacyMappingCoverageItem['family']): string | null {
  if (!['group', 'role'].includes(mapping.claimType)) return 'Custom and email-domain claims require an explicit provider-neutral design.';
  if (!([null, 'equals', 'contains', 'exists'] as Array<string | null>).includes(mapping.claimOperator)) return 'Negated, multi-value, wildcard, and regex claim operators require an explicit provider-neutral design.';
  if (family === 'engine_assignment') return null;
  return null;
}

class LegacyMappingCoverageService {
  async getCoverage(tenantId?: string | null): Promise<LegacyMappingCoverageItem[]> {
    const dataSource = await getDataSource();
    const normalizedTenantId = tenantId?.trim() || null;
    const [platformMappings, groupMappings, assignmentMappings, identityMappings, assignments, verificationEvents] = await Promise.all([
      dataSource.getRepository(SsoClaimsMapping).find({ where: { isActive: true } }),
      dataSource.getRepository(SsoGroupMapping).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId, isActive: true }, { tenantId: IsNull(), isActive: true }] : { tenantId: IsNull(), isActive: true } as any }),
      dataSource.getRepository(SsoAssignmentMapping).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId, isActive: true }, { tenantId: IsNull(), isActive: true }] : { tenantId: IsNull(), isActive: true } as any }),
      dataSource.getRepository(IdentityEntitlementMapping).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : { tenantId: IsNull() } as any }),
      dataSource.getRepository(RbacRoleAssignment).find({ where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : { tenantId: IsNull() } as any }),
      dataSource.getRepository(AuditLog).find({ where: normalizedTenantId ? { tenantId: normalizedTenantId, action: 'authz.legacy_mapping_coverage.verify' } : { tenantId: IsNull(), action: 'authz.legacy_mapping_coverage.verify' }, order: { createdAt: 'DESC' } }),
    ]);

    const verificationByKey = new Map<string, LegacyMappingCoverageItem['verification']>();
    for (const event of verificationEvents) {
      try {
        const details = JSON.parse(event.details || '{}') as { legacyMappingId?: string; family?: LegacyMappingCoverageItem['family']; candidateIdentityMappingId?: string; note?: string };
        if (!details.legacyMappingId || !details.family || !details.candidateIdentityMappingId) continue;
        const key = `${details.family}:${details.legacyMappingId}`;
        if (!verificationByKey.has(key)) verificationByKey.set(key, { candidateIdentityMappingId: details.candidateIdentityMappingId, verifiedById: event.userId, verifiedAt: event.createdAt, note: details.note || '' });
      } catch { /* A malformed historic audit row must not block diagnostics. */ }
    }

    const items: LegacyMappingCoverageItem[] = [];
    for (const mapping of platformMappings) {
      const unsupported = unsupportedReason(mapping, 'platform_role');
      if (unsupported) { items.push({ id: mapping.id, family: 'platform_role', status: 'manual_redesign_required', reason: unsupported, candidateIdentityMappingIds: [], verification: null }); continue; }
      const roleId = mapping.targetRole === 'admin' ? SYSTEM_ROLE_IDS.PLATFORM_ADMIN : SYSTEM_ROLE_IDS.PLATFORM_USER;
      const candidates = identityMappings.filter((candidate) => candidate.tenantId === null && matchShape(mapping, candidate) && assignments.some((assignment) => assignment.principalType === 'group' && assignment.principalId === candidate.targetGroupId && assignment.roleId === roleId && assignment.scopeType === 'platform'));
      items.push({ id: mapping.id, family: 'platform_role', status: candidates.length ? 'replacement_candidate' : 'no_replacement_candidate', reason: candidates.length ? 'A matching provider-neutral group grant exists; verify representative sign-in before retirement.' : 'No matching provider-neutral group grant was found.', candidateIdentityMappingIds: candidates.map((candidate) => candidate.id), verification: verificationByKey.get(`platform_role:${mapping.id}`) || null });
    }
    for (const mapping of groupMappings) {
      const unsupported = unsupportedReason(mapping, 'group');
      if (unsupported) { items.push({ id: mapping.id, family: 'group', status: 'manual_redesign_required', reason: unsupported, candidateIdentityMappingIds: [], verification: null }); continue; }
      const candidates = identityMappings.filter((candidate) => candidate.targetGroupId === mapping.targetGroupId && matchShape(mapping, candidate));
      items.push({ id: mapping.id, family: 'group', status: candidates.length ? 'replacement_candidate' : 'no_replacement_candidate', reason: candidates.length ? 'A matching provider-neutral group mapping exists; verify representative sign-in before retirement.' : 'No matching provider-neutral group mapping was found.', candidateIdentityMappingIds: candidates.map((candidate) => candidate.id), verification: verificationByKey.get(`group:${mapping.id}`) || null });
    }
    for (const mapping of assignmentMappings) {
      if (mapping.targetSelectorType !== 'engine_id' || !mapping.targetEngineId) { items.push({ id: mapping.id, family: 'engine_assignment', status: 'manual_redesign_required', reason: 'Dynamic engine selectors require an explicit Engine Set and group assignment.', candidateIdentityMappingIds: [], verification: null }); continue; }
      const unsupported = unsupportedReason(mapping, 'engine_assignment');
      if (unsupported) { items.push({ id: mapping.id, family: 'engine_assignment', status: 'manual_redesign_required', reason: unsupported, candidateIdentityMappingIds: [], verification: null }); continue; }
      const candidates = identityMappings.filter((candidate) => matchShape(mapping, candidate) && assignments.some((assignment) => assignment.principalType === 'group' && assignment.principalId === candidate.targetGroupId && assignment.roleId === mapping.targetRoleId && assignment.scopeType === 'engine' && assignment.scopeId === mapping.targetEngineId));
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
}

export const legacyMappingCoverageService = new LegacyMappingCoverageService();
