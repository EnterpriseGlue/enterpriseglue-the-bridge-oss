import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import type { IdentityClaims } from './IdentityClaims.js';

export type SsoProviderIdentityStatus = 'active' | 'inactive' | 'deleted' | 'unsupported' | 'unknown';

export interface SsoProviderIdentityCheckResult {
  status: SsoProviderIdentityStatus;
  reason: string;
  checkedAt: number;
  details?: Record<string, unknown>;
  profile?: {
    email?: string | null;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
}

export type SsoProviderGroupStatus = 'active' | 'deleted' | 'unsupported' | 'unknown';

export interface SsoProviderGroupCheckInput {
  providerId?: string | null;
  providerType?: string | null;
  providerTenantId?: string | null;
  groupClaimValue: string;
}

export interface SsoProviderGroupCheckResult {
  status: SsoProviderGroupStatus;
  reason: string;
  checkedAt: number;
  details?: Record<string, unknown>;
  group?: {
    id?: string | null;
    displayName?: string | null;
  };
}

export type SsoProviderClaimsRefreshStatus = 'refreshed' | 'unsupported' | 'unknown';

export interface SsoProviderClaimsRefreshResult {
  status: SsoProviderClaimsRefreshStatus;
  reason: string;
  checkedAt: number;
  claims?: IdentityClaims;
  details?: Record<string, unknown>;
}

function normalizedProviderType(providerType: string | null | undefined, providerId: string | null | undefined): string {
  return (providerType || providerId || '').trim().toLowerCase();
}

function providerLabel(providerType: string): string {
  if (providerType === 'saml') return 'SAML';
  if (providerType === 'oidc') return 'OIDC';
  if (providerType === 'microsoft' || providerType === 'entra') return 'Microsoft Entra ID';
  if (providerType === 'google') return 'Google';
  return providerType || 'SSO';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

/**
 * This sign-in-provider diagnostic deliberately has no implicit Microsoft
 * Graph or SCIM enumeration path. OIDC/Entra access is reconciled from a fresh,
 * verified token during sign-in, SCIM lifecycle changes arrive through the
 * separate provider-push service API, and LDAP has its bounded authoritative
 * directory run. These methods therefore never make an implicit outbound
 * request or establish a second lifecycle authority.
 */
class SsoProviderIdentityCheckServiceClass {
  async checkIdentity(identity: SsoNormalizedIdentity): Promise<SsoProviderIdentityCheckResult> {
    const providerType = normalizedProviderType(identity.providerType, identity.providerId);
    return {
      status: 'unsupported',
      reason: `Provider type ${providerType || 'unknown'} does not support a live background identity check in 0.11`,
      checkedAt: Date.now(),
      details: {
        providerId: identity.providerId,
        providerType,
        authority: providerType === 'ldap' ? 'ldap_authoritative_reconciliation' : 'mandatory_verified_sign_in',
      },
    };
  }

  async checkGroup(input: SsoProviderGroupCheckInput): Promise<SsoProviderGroupCheckResult> {
    const providerType = normalizedProviderType(input.providerType, input.providerId);
    return {
      status: 'unsupported',
      reason: `Provider type ${providerType || 'unknown'} does not support a live background group check in 0.11`,
      checkedAt: Date.now(),
      details: {
        providerId: input.providerId || null,
        providerType,
        groupClaimValue: input.groupClaimValue,
      },
    };
  }

  async refreshClaims(identity: SsoNormalizedIdentity, currentClaims: IdentityClaims): Promise<SsoProviderClaimsRefreshResult> {
    const providerType = normalizedProviderType(identity.providerType, identity.providerId);
    if (!['saml', 'oidc', 'google', 'microsoft', 'entra'].includes(providerType)) {
      return {
        status: 'unsupported',
        reason: `Provider type ${providerType || 'unknown'} does not support stored claim replay`,
        checkedAt: Date.now(),
        details: { providerId: identity.providerId, providerType },
      };
    }

    const groups = normalizeStringArray(currentClaims.groups);
    const roles = normalizeStringArray(currentClaims.roles);
    const claims: IdentityClaims = { ...currentClaims, groups, roles };
    if (!claims.email && identity.email) claims.email = identity.email;

    return {
      status: 'refreshed',
      reason: `${providerLabel(providerType)} claims refreshed from the latest normalized login snapshot`,
      checkedAt: Date.now(),
      claims,
      details: {
        providerId: identity.providerId,
        providerType,
        refreshMode: 'normalized_identity_snapshot',
        liveRefreshSupported: false,
        groupsCount: groups.length,
        rolesCount: roles.length,
        lastSeenAt: Number(identity.lastSeenAt),
      },
    };
  }
}

export const ssoProviderIdentityCheckService = new SsoProviderIdentityCheckServiceClass();
