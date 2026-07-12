/**
 * SSO Claims Mapping Service
 *
 * Maps SSO provider claims (groups, roles, email domains) to platform roles.
 * Used during OAuth callback to determine user's platformRole.
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import type { PlatformRole as SharedPlatformRole } from '@enterpriseglue/shared/contracts/auth.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { SsoClaimsMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoClaimsMapping.js';
import type { DataSource, EntityManager } from 'typeorm';
import { IsNull } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

export type ClaimType = 'group' | 'role' | 'email_domain' | 'custom';
export type PlatformRole = SharedPlatformRole;
export type SsoClaimOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'contains_any'
  | 'not_contains_any'
  | 'contains_all'
  | 'not_contains_all'
  | 'matches_regex'
  | 'not_matches_regex'
  | 'exists'
  | 'not_exists';

export const SSO_CLAIM_OPERATORS: SsoClaimOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'contains_any',
  'not_contains_any',
  'contains_all',
  'not_contains_all',
  'matches_regex',
  'not_matches_regex',
  'exists',
  'not_exists',
];

// Role priority for determining "highest" role
const ROLE_PRIORITY: Record<PlatformRole, number> = {
  admin: 100,
  user: 0,
};

export interface SsoClaims {
  email?: string;
  groups?: string[];
  roles?: string[];
  [key: string]: any;
}

export interface ClaimsMappingInput {
  providerId?: string;
  claimType: ClaimType;
  claimKey: string;
  claimValue: string;
  claimOperator?: SsoClaimOperator | null;
  targetRole: PlatformRole;
  priority?: number;
  isActive?: boolean;
  riskAcknowledged?: boolean;
}

export interface SsoClaimRule {
  claimType: ClaimType | string;
  claimKey: string;
  claimValue: string;
  claimOperator?: SsoClaimOperator | string | null;
}

function normalizeRoleValue(role?: string | null): PlatformRole {
  return role === 'admin' ? 'admin' : 'user';
}

function matchWildcard(value: string, pattern: string): boolean {
  if (pattern === '*') return true;

  const v = value.toLowerCase();
  const p = pattern.toLowerCase();

  if (p.startsWith('*') && p.endsWith('*')) {
    return v.includes(p.slice(1, -1));
  }
  if (p.startsWith('*')) {
    return v.endsWith(p.slice(1));
  }
  if (p.endsWith('*')) {
    return v.startsWith(p.slice(0, -1));
  }

  return v === p;
}

function matchArrayClaim(values: string[] | undefined, pattern: string): boolean {
  if (!values || !Array.isArray(values)) return false;
  if (pattern === '*') return values.length > 0;
  return values.some(v => matchWildcard(v, pattern));
}

function matchEmailDomain(email: string | undefined, pattern: string): boolean {
  if (!email) return false;
  if (pattern === '*') return true;
  if (pattern.startsWith('*@')) {
    const domain = pattern.slice(2).toLowerCase();
    return email.toLowerCase().endsWith('@' + domain);
  }
  return email.toLowerCase() === pattern.toLowerCase();
}

function normalizeClaimOperator(operator: string | null | undefined): SsoClaimOperator | null {
  const normalized = String(operator || '').trim();
  if (!normalized) return null;
  return (SSO_CLAIM_OPERATORS as string[]).includes(normalized) ? normalized as SsoClaimOperator : null;
}

export function ssoClaimOperatorIsRegex(operator: string | null | undefined): boolean {
  const normalized = normalizeClaimOperator(operator);
  return normalized === 'matches_regex' || normalized === 'not_matches_regex';
}

export function ssoClaimOperatorRequiresValue(operator: string | null | undefined): boolean {
  const normalized = normalizeClaimOperator(operator);
  return normalized !== 'exists' && normalized !== 'not_exists';
}

function splitExpectedValues(value: string): string[] {
  const trimmed = String(value || '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return Array.from(new Set(parsed.map((item) => String(item || '').trim()).filter(Boolean)));
    }
  } catch {
    // Treat non-JSON values as comma/newline-separated lists.
  }
  return Array.from(new Set(trimmed.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)));
}

function normalizeComparableValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmailDomainValue(value: string): string {
  const normalized = normalizeComparableValue(value);
  if (normalized.startsWith('*@')) return normalized.slice(2);
  const atIndex = normalized.lastIndexOf('@');
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : normalized;
}

function claimExists(values: string[]): boolean {
  return values.length > 0;
}

function matchExplicitOperator(values: string[], claimValue: string, operator: SsoClaimOperator, claimType: string): boolean {
  const comparableValues = claimType === 'email_domain'
    ? values.map(normalizeEmailDomainValue)
    : values.map(normalizeComparableValue);
  const expected = claimType === 'email_domain'
    ? normalizeEmailDomainValue(claimValue)
    : normalizeComparableValue(claimValue);
  const expectedValues = splitExpectedValues(claimValue).map((value) => claimType === 'email_domain'
    ? normalizeEmailDomainValue(value)
    : normalizeComparableValue(value));

  switch (operator) {
    case 'exists':
      return claimExists(values);
    case 'not_exists':
      return !claimExists(values);
    case 'equals':
      return Boolean(expected) && comparableValues.some((value) => value === expected);
    case 'not_equals':
      return !Boolean(expected) || !comparableValues.some((value) => value === expected);
    case 'contains':
      return Boolean(expected) && comparableValues.some((value) => value.includes(expected));
    case 'not_contains':
      return !Boolean(expected) || !comparableValues.some((value) => value.includes(expected));
    case 'contains_any':
      return expectedValues.length > 0 && expectedValues.some((value) => comparableValues.includes(value));
    case 'not_contains_any':
      return expectedValues.length === 0 || !expectedValues.some((value) => comparableValues.includes(value));
    case 'contains_all':
      return expectedValues.length > 0 && expectedValues.every((value) => comparableValues.includes(value));
    case 'not_contains_all':
      return expectedValues.length === 0 || !expectedValues.every((value) => comparableValues.includes(value));
    case 'matches_regex': {
      if (!claimValue.trim() || claimValue.length > 512) return false;
      try {
        const regex = new RegExp(claimValue, 'i');
        return values.some((value) => regex.test(value));
      } catch {
        return false;
      }
    }
    case 'not_matches_regex': {
      if (!claimValue.trim() || claimValue.length > 512) return true;
      try {
        const regex = new RegExp(claimValue, 'i');
        return !values.some((value) => regex.test(value));
      } catch {
        return true;
      }
    }
    default:
      return false;
  }
}

function getClaimValues(claims: SsoClaims, rule: SsoClaimRule): string[] {
  switch (rule.claimType) {
    case 'group':
      return Array.isArray(claims.groups) ? claims.groups.map((value) => String(value || '').trim()).filter(Boolean) : [];
    case 'role':
      return Array.isArray(claims.roles) ? claims.roles.map((value) => String(value || '').trim()).filter(Boolean) : [];
    case 'email_domain':
      return claims.email ? [String(claims.email).trim()] : [];
    case 'custom': {
      const customValue = claims[rule.claimKey];
      if (Array.isArray(customValue)) {
        return customValue.map((value) => String(value || '').trim()).filter(Boolean);
      }
      if (customValue === undefined || customValue === null) {
        return [];
      }
      return [String(customValue).trim()].filter(Boolean);
    }
    default:
      return [];
  }
}

export function ssoClaimMatches(claims: SsoClaims, rule: SsoClaimRule): boolean {
  const { claimType, claimKey, claimValue } = rule;
  const claimOperator = normalizeClaimOperator(rule.claimOperator);
  if (rule.claimOperator && !claimOperator) {
    return false;
  }

  if (claimOperator) {
    return matchExplicitOperator(getClaimValues(claims, rule), claimValue || '', claimOperator, claimType);
  }

  switch (claimType) {
    case 'group':
      return matchArrayClaim(claims.groups, claimValue);

    case 'role':
      return matchArrayClaim(claims.roles, claimValue);

    case 'email_domain':
      return matchEmailDomain(claims.email, claimValue);

    case 'custom': {
      const customValue = claims[claimKey];
      if (Array.isArray(customValue)) {
        return matchArrayClaim(customValue, claimValue);
      }
      return matchWildcard(String(customValue || ''), claimValue);
    }

    default:
      return false;
  }
}

class SsoClaimsMappingServiceClass {
  /**
   * Resolve platform role from SSO claims.
   * Returns the highest-priority matching role.
   *
   * @param claims - Claims from SSO provider (groups, roles, email, etc.)
   * @param providerId - Optional provider ID to filter mappings
   * @param fallbackRole - Role used only when no mappings match
   * @returns The resolved platform role
   */
  async resolveRoleFromClaims(
    claims: SsoClaims,
    providerId?: string,
    fallbackRole: PlatformRole = 'user'
  ): Promise<PlatformRole> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);

    // Get all active mappings, ordered by priority (highest first)
    const qb = mappingRepo.createQueryBuilder('m')
      .where('m.isActive = :isActive', { isActive: true })
      .andWhere(providerId
        ? '(m.providerId IS NULL OR m.providerId = :providerId)'
        : 'm.providerId IS NULL',
        providerId ? { providerId } : {}
      )
      .orderBy('m.priority', 'DESC');

    const mappings = await qb.getMany();

    let highestRole: PlatformRole = fallbackRole;
    let highestPriority = -1;

    for (const mapping of mappings) {
      if (!(await this.platformSettingsAllowRegexMapping(dataSource, mapping))) {
        continue;
      }
      const matches = this.claimMatches(claims, mapping);

      if (matches) {
        const role = normalizeRoleValue(mapping.targetRole);
        const rolePriority = ROLE_PRIORITY[role] ?? 0;

        // Use mapping priority first, then role priority as tiebreaker
        if (mapping.priority > highestPriority ||
            (mapping.priority === highestPriority && rolePriority > ROLE_PRIORITY[highestRole])) {
          highestRole = role;
          highestPriority = mapping.priority;
        }
      }
    }

    return highestRole;
  }

  /**
   * Check if claims match a mapping rule
   */
  private claimMatches(claims: SsoClaims, mapping: SsoClaimsMapping): boolean {
    return ssoClaimMatches(claims, mapping);
  }

  /**
   * Match against an array claim (groups, roles)
   */
  private matchArrayClaim(values: string[] | undefined, pattern: string): boolean {
    return matchArrayClaim(values, pattern);
  }

  /**
   * Match email domain pattern
   * Supports: *@domain.com, user@domain.com, *
   */
  private matchEmailDomain(email: string | undefined, pattern: string): boolean {
    return matchEmailDomain(email, pattern);
  }

  /**
   * Match with wildcard support
   * Supports: * (any), prefix*, *suffix, exact
   */
  private matchWildcard(value: string, pattern: string): boolean {
    return matchWildcard(value, pattern);
  }

  // ============================================================================
  // CRUD Operations for Admin UI
  // ============================================================================

  async getAllMappings(): Promise<SsoClaimsMapping[]> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);
    const mappings = await mappingRepo.find({ order: { priority: 'DESC' } });
    mappings.forEach((mapping) => {
      mapping.targetRole = normalizeRoleValue(mapping.targetRole);
    });
    return mappings;
  }

  async createMapping(input: ClaimsMappingInput): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);
    const id = generateId();
    const now = Date.now();
    if (!input.claimKey?.trim()) {
      throw new Error('claimKey is required');
    }
    if (ssoClaimOperatorRequiresValue(input.claimOperator) && !input.claimValue?.trim()) {
      throw new Error('claimValue is required');
    }
    await this.validateRegexMappingRisk(dataSource, input);

    await mappingRepo.insert({
      id,
      providerId: input.providerId || null,
      claimType: input.claimType,
      claimKey: input.claimKey,
      claimValue: input.claimValue || '',
      claimOperator: input.claimOperator || null,
      targetRole: normalizeRoleValue(input.targetRole),
      priority: input.priority ?? 0,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  }

  async updateMapping(id: string, updates: Partial<ClaimsMappingInput & { isActive?: boolean }>): Promise<void> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);
    const now = Date.now();
    const existing = await mappingRepo.findOneBy({ id });
    if (!existing) {
      throw new Error('SSO mapping not found');
    }

    const updateData: any = { updatedAt: now };
    if (updates.providerId !== undefined) updateData.providerId = updates.providerId || null;
    if (updates.claimType !== undefined) updateData.claimType = updates.claimType;
    if (updates.claimKey !== undefined) updateData.claimKey = updates.claimKey;
    if (updates.claimValue !== undefined) updateData.claimValue = updates.claimValue || '';
    if (updates.claimOperator !== undefined) updateData.claimOperator = updates.claimOperator || null;
    const claimOperator = updates.claimOperator;
    const claimValue = updates.claimValue;
    const mergedClaimOperator = claimOperator !== undefined ? claimOperator : existing.claimOperator as SsoClaimOperator | null;
    const mergedClaimValue = claimValue !== undefined ? claimValue : existing.claimValue;
    if (ssoClaimOperatorRequiresValue(mergedClaimOperator) && !mergedClaimValue.trim()) {
      throw new Error('claimValue is required');
    }
    if (updates.targetRole !== undefined) updateData.targetRole = normalizeRoleValue(updates.targetRole);
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    await this.validateRegexMappingRisk(dataSource, {
      claimOperator: mergedClaimOperator,
      isActive: updates.isActive !== undefined ? updates.isActive : existing.isActive,
      riskAcknowledged: updates.riskAcknowledged,
    });

    await mappingRepo.update({ id }, updateData);
  }

  async deleteMapping(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);
    await mappingRepo.delete({ id });
  }

  /**
   * Test claims against mappings (for admin preview)
   */
  async testClaims(claims: SsoClaims, providerId?: string): Promise<{
    resolvedRole: PlatformRole;
    matchedMappings: Array<{ id: string; name: string; targetRole: string }>;
  }> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);

    const qb = mappingRepo.createQueryBuilder('m')
      .where('m.isActive = :isActive', { isActive: true })
      .andWhere(providerId
        ? '(m.providerId IS NULL OR m.providerId = :providerId)'
        : 'm.providerId IS NULL',
        providerId ? { providerId } : {}
      )
      .orderBy('m.priority', 'DESC');

    const mappings = await qb.getMany();

    const matchedMappings: Array<{ id: string; name: string; targetRole: string }> = [];

    for (const mapping of mappings) {
      if (!(await this.platformSettingsAllowRegexMapping(dataSource, mapping))) {
        continue;
      }
      if (this.claimMatches(claims, mapping)) {
        matchedMappings.push({
          id: mapping.id,
          name: `${mapping.claimType}:${mapping.claimKey}=${mapping.claimValue}`,
          targetRole: mapping.targetRole,
        });
      }
    }

    const resolvedRole = await this.resolveRoleFromClaims(claims, providerId);

    return { resolvedRole, matchedMappings };
  }

  private async validateRegexMappingRisk(
    dataSource: DataSource | EntityManager,
    input: Pick<ClaimsMappingInput, 'claimOperator' | 'riskAcknowledged' | 'isActive'>
  ): Promise<void> {
    if (input.isActive === false || !ssoClaimOperatorIsRegex(input.claimOperator)) {
      return;
    }
    if (input.riskAcknowledged !== true) {
      throw new Error('High-risk SSO regex claim mapping requires acknowledgement');
    }
    if (!(await this.platformSettingsAllowRegexMapping(dataSource, input))) {
      throw new Error('High-risk SSO regex claim mappings are disabled by platform settings');
    }
  }

  private async platformSettingsAllowRegexMapping(
    dataSource: DataSource | EntityManager,
    mapping: { claimOperator?: SsoClaimOperator | string | null }
  ): Promise<boolean> {
    if (!ssoClaimOperatorIsRegex(mapping.claimOperator)) {
      return true;
    }
    const settings = await dataSource.getRepository(PlatformSettings).findOneBy({ id: 'default' });
    return (settings as any)?.ssoRegexClaimMappingsEnabled ?? false;
  }
}

export const ssoClaimsMappingService = new SsoClaimsMappingServiceClass();
