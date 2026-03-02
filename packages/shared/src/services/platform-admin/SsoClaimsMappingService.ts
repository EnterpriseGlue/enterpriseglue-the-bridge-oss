/**
 * SSO Claims Mapping Service
 * 
 * Maps SSO provider claims (groups, roles, email domains) to platform roles.
 * Used during OAuth callback to determine user's platformRole.
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoClaimsMapping } from '@enterpriseglue/shared/db/entities/SsoClaimsMapping.js';
import { IsNull } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

export type ClaimType = 'group' | 'role' | 'email_domain' | 'custom';
export type PlatformRole = 'admin' | 'developer' | 'user';

// Role priority for determining "highest" role
const ROLE_PRIORITY: Record<PlatformRole, number> = {
  admin: 100,
  developer: 50,
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
  targetRole: PlatformRole;
  priority?: number;
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
      const matches = this.claimMatches(claims, mapping);
      
      if (matches) {
        const role = mapping.targetRole as PlatformRole;
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
    const { claimType, claimKey, claimValue } = mapping;

    switch (claimType) {
      case 'group':
        return this.matchArrayClaim(claims.groups, claimValue);
      
      case 'role':
        return this.matchArrayClaim(claims.roles, claimValue);
      
      case 'email_domain':
        return this.matchEmailDomain(claims.email, claimValue);
      
      case 'custom':
        // Custom claim: check claims[claimKey] against claimValue
        const customValue = claims[claimKey];
        if (Array.isArray(customValue)) {
          return this.matchArrayClaim(customValue, claimValue);
        }
        return this.matchWildcard(String(customValue || ''), claimValue);
      
      default:
        return false;
    }
  }

  /**
   * Match against an array claim (groups, roles)
   */
  private matchArrayClaim(values: string[] | undefined, pattern: string): boolean {
    if (!values || !Array.isArray(values)) return false;
    
    // Wildcard matches any non-empty array
    if (pattern === '*') return values.length > 0;
    
    // Check if any value matches the pattern
    return values.some(v => this.matchWildcard(v, pattern));
  }

  /**
   * Match email domain pattern
   * Supports: *@domain.com, user@domain.com, *
   */
  private matchEmailDomain(email: string | undefined, pattern: string): boolean {
    if (!email) return false;
    
    // Wildcard matches any email
    if (pattern === '*') return true;
    
    // Domain wildcard: *@domain.com
    if (pattern.startsWith('*@')) {
      const domain = pattern.slice(2).toLowerCase();
      return email.toLowerCase().endsWith('@' + domain);
    }
    
    // Exact match
    return email.toLowerCase() === pattern.toLowerCase();
  }

  /**
   * Match with wildcard support
   * Supports: * (any), prefix*, *suffix, exact
   */
  private matchWildcard(value: string, pattern: string): boolean {
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

  // ============================================================================
  // CRUD Operations for Admin UI
  // ============================================================================

  async getAllMappings(): Promise<SsoClaimsMapping[]> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);
    return mappingRepo.find({ order: { priority: 'DESC' } });
  }

  async createMapping(input: ClaimsMappingInput): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);
    const id = generateId();
    const now = Date.now();

    await mappingRepo.insert({
      id,
      providerId: input.providerId || null,
      claimType: input.claimType,
      claimKey: input.claimKey,
      claimValue: input.claimValue,
      targetRole: input.targetRole,
      priority: input.priority ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  }

  async updateMapping(id: string, updates: Partial<ClaimsMappingInput & { isActive?: boolean }>): Promise<void> {
    const dataSource = await getDataSource();
    const mappingRepo = dataSource.getRepository(SsoClaimsMapping);
    const now = Date.now();

    const updateData: any = { updatedAt: now };
    if (updates.providerId !== undefined) updateData.providerId = updates.providerId || null;
    if (updates.claimType !== undefined) updateData.claimType = updates.claimType;
    if (updates.claimKey !== undefined) updateData.claimKey = updates.claimKey;
    if (updates.claimValue !== undefined) updateData.claimValue = updates.claimValue;
    if (updates.targetRole !== undefined) updateData.targetRole = updates.targetRole;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

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
}

export const ssoClaimsMappingService = new SsoClaimsMappingServiceClass();
