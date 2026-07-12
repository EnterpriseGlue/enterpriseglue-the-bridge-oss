import { describe, expect, it } from 'vitest';
import { ldapIdentityProviderAdapter, oidcIdentityProviderAdapter, samlIdentityProviderAdapter } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';

describe('identity provider adapters', () => {
  it('normalizes OIDC groups, roles, and delegated scopes deterministically', () => {
    expect(oidcIdentityProviderAdapter.normalizeIdentity({
      providerKey: 'entra-prod', subjectId: 'oid-1', email: 'USER@example.com', observedAt: 10,
      claims: { groups: ['g2', 'g1', 'g1'], roles: ['operator'], scp: 'files.read engines.read' },
    })).toEqual(expect.objectContaining({
      providerType: 'oidc', email: 'user@example.com', observedAt: 10,
      entitlements: [
        { type: 'group', externalId: 'g1' }, { type: 'group', externalId: 'g2' },
        { type: 'role', externalId: 'operator' },
        { type: 'scope', externalId: 'engines.read' }, { type: 'scope', externalId: 'files.read' },
      ],
    }));
  });

  it('normalizes SAML and LDAP membership aliases without protocol-specific mapping logic', () => {
    expect(samlIdentityProviderAdapter.normalizeIdentity({ providerKey: 'saml', subjectId: 'name-id', claims: { group: 'payments' }, observedAt: 1 }).entitlements)
      .toEqual([{ type: 'group', externalId: 'payments' }]);
    expect(ldapIdentityProviderAdapter.normalizeIdentity({ providerKey: 'ldap', subjectId: 'uuid-1', claims: { memberOf: ['CN=Ops,DC=example', 'CN=Ops,DC=example'] }, observedAt: 1 }).entitlements)
      .toEqual([{ type: 'group', externalId: 'CN=Ops,DC=example' }]);
  });
});
