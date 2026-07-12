import { describe, expect, it } from 'vitest';
import {
  getIdentityProviderAdapter,
  ldapIdentityProviderAdapter,
  oidcIdentityProviderAdapter,
  samlIdentityProviderAdapter,
  type IdentityProviderAdapter,
} from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';

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

function identityAdapterContract(name: string, adapter: IdentityProviderAdapter) {
  describe(`${name} identity adapter contract`, () => {
    it('returns a deterministic, provider-neutral entitlement envelope', () => {
      const identity = adapter.normalizeIdentity({
        providerKey: `provider-${name}`,
        subjectId: 'subject-1',
        email: 'Person@Example.COM',
        username: 'person',
        directoryTenantId: 'directory-1',
        observedAt: 42,
        claims: {
          groups: ['group-b', 'group-a', 'group-a'],
          roles: ['operator', 'operator'],
          scp: 'engine.read engine.read files.read',
        },
      });

      expect(identity).toEqual({
        providerKey: `provider-${name}`,
        providerType: adapter.type,
        subjectId: 'subject-1',
        username: 'person',
        email: 'person@example.com',
        directoryTenantId: 'directory-1',
        observedAt: 42,
        entitlements: [
          { type: 'group', externalId: 'group-a' },
          { type: 'group', externalId: 'group-b' },
          { type: 'role', externalId: 'operator' },
          { type: 'scope', externalId: 'engine.read' },
          { type: 'scope', externalId: 'files.read' },
        ],
      });
    });

    it('accepts protocol claim aliases while rejecting missing stable identity fields', () => {
      expect(adapter.normalizeIdentity({
        providerKey: `provider-${name}`,
        subjectId: 'subject-1',
        claims: { group: 'ops', role: 'reader', scope: 'engine.read' },
        observedAt: 1,
      }).entitlements).toEqual([
        { type: 'group', externalId: 'ops' },
        { type: 'role', externalId: 'reader' },
        { type: 'scope', externalId: 'engine.read' },
      ]);
      expect(() => adapter.normalizeIdentity({ providerKey: ' ', subjectId: 'subject-1', claims: {} })).toThrow('providerKey is required');
      expect(() => adapter.normalizeIdentity({ providerKey: `provider-${name}`, subjectId: ' ', claims: {} })).toThrow('subjectId is required');
    });
  });
}

identityAdapterContract('oidc', oidcIdentityProviderAdapter);
identityAdapterContract('saml', samlIdentityProviderAdapter);
identityAdapterContract('ldap', ldapIdentityProviderAdapter);
identityAdapterContract('lookup', getIdentityProviderAdapter('oidc'));
