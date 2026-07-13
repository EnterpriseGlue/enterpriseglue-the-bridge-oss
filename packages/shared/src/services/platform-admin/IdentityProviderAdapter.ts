export type IdentityProviderType = 'oidc' | 'saml' | 'ldap';
export type ExternalEntitlementType = 'group' | 'role' | 'scope' | 'attribute' | 'authenticated';

export interface ExternalEntitlement {
  type: ExternalEntitlementType;
  externalId: string;
  displayName?: string;
  value?: string;
}

export interface NormalizedExternalIdentity {
  providerKey: string;
  providerType: IdentityProviderType;
  subjectId: string;
  username?: string;
  email?: string;
  directoryTenantId?: string;
  entitlements: ExternalEntitlement[];
  observedAt: number;
}

export interface ProviderIdentityInput {
  providerKey: string;
  subjectId: string;
  claims: Record<string, unknown>;
  username?: string | null;
  email?: string | null;
  directoryTenantId?: string | null;
  observedAt?: number;
}

export interface IdentityProviderAdapter {
  readonly type: IdentityProviderType;
  normalizeIdentity(input: ProviderIdentityInput): NormalizedExternalIdentity;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function values(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value == null ? [] : [String(value)];
  return Array.from(new Set(source.map((entry) => String(entry).trim()).filter(Boolean))).sort();
}

function scopeValues(value: unknown): string[] {
  return values(value).flatMap((entry) => entry.split(/\s+/)).filter(Boolean).sort();
}

function entitlement(type: ExternalEntitlementType, value: string): ExternalEntitlement {
  return { type, externalId: value };
}

/**
 * Entra and compatible OIDC providers omit group values when a token exceeds
 * their group-claim limit. Treating that token as an empty group set would
 * incorrectly remove access in authoritative mappings.
 */
export function hasIncompleteOidcGroupClaims(claims: Record<string, unknown>): boolean {
  if (claims.hasgroups === true || claims.groups_overage === true || claims.group_overage === true) return true;
  const claimNames = claims._claim_names;
  return Boolean(
    claimNames
    && typeof claimNames === 'object'
    && !Array.isArray(claimNames)
    && Object.prototype.hasOwnProperty.call(claimNames, 'groups'),
  );
}

class ClaimsIdentityAdapter implements IdentityProviderAdapter {
  constructor(readonly type: IdentityProviderType) {}

  normalizeIdentity(input: ProviderIdentityInput): NormalizedExternalIdentity {
    const claims = input.claims || {};
    if (this.type === 'oidc' && hasIncompleteOidcGroupClaims(claims)) {
      throw new Error('OIDC group claims are incomplete; resolve group overage before synchronizing authorization');
    }
    const entitlements = [
      // This synthetic entitlement exists only after the provider has validated
      // the subject. It supports explicit provider-default group mappings.
      entitlement('authenticated', 'authenticated'),
      ...values(claims.groups ?? claims.group ?? claims.memberOf).map((value) => entitlement('group', value)),
      ...values(claims.roles ?? claims.role ?? claims.appRoles).map((value) => entitlement('role', value)),
      ...scopeValues(claims.scp ?? claims.scope).map((value) => entitlement('scope', value)),
    ];
    const seen = new Set<string>();
    return {
      providerKey: required(input.providerKey, 'providerKey'),
      providerType: this.type,
      subjectId: required(input.subjectId, 'subjectId'),
      username: input.username?.trim() || undefined,
      email: input.email?.trim().toLowerCase() || undefined,
      directoryTenantId: input.directoryTenantId?.trim() || undefined,
      entitlements: entitlements.filter((entry) => {
        const key = `${entry.type}:${entry.externalId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
      observedAt: input.observedAt ?? Date.now(),
    };
  }
}

export const oidcIdentityProviderAdapter = new ClaimsIdentityAdapter('oidc');
export const samlIdentityProviderAdapter = new ClaimsIdentityAdapter('saml');
export const ldapIdentityProviderAdapter = new ClaimsIdentityAdapter('ldap');

export function getIdentityProviderAdapter(type: IdentityProviderType): IdentityProviderAdapter {
  if (type === 'oidc') return oidcIdentityProviderAdapter;
  if (type === 'saml') return samlIdentityProviderAdapter;
  return ldapIdentityProviderAdapter;
}
