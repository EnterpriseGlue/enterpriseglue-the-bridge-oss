import { describe, expect, it } from 'vitest';
import {
  getIdentityProviderAdapter,
  ldapIdentityProviderAdapter,
  oidcIdentityProviderAdapter,
  samlIdentityProviderAdapter,
  type IdentityProviderAdapter,
} from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { allowlistedIdentityClaims } from '@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js';
import { inMemoryIdentityProviderAdapter } from '../../../../test/identity-mocks/index.js';

describe('identity provider adapters', () => {
  it('normalizes OIDC groups, roles, and delegated scopes deterministically', () => {
    expect(oidcIdentityProviderAdapter.normalizeIdentity({
      providerKey: 'entra-prod', subjectId: 'oid-1', email: 'USER@example.com', observedAt: 10,
      claims: { groups: ['g2', 'g1', 'g1'], roles: ['operator'], scp: 'files.read engines.read' },
    })).toEqual(expect.objectContaining({
      providerType: 'oidc', email: 'user@example.com', observedAt: 10,
      entitlements: [
        { type: 'authenticated', externalId: 'authenticated' },
        { type: 'group', externalId: 'g1' }, { type: 'group', externalId: 'g2' },
        { type: 'role', externalId: 'operator' },
        { type: 'scope', externalId: 'engines.read' }, { type: 'scope', externalId: 'files.read' },
        { type: 'attribute', externalId: 'email_domain:example.com' },
      ],
    }));
  });

  it('normalizes SAML and LDAP membership aliases without protocol-specific mapping logic', () => {
    expect(samlIdentityProviderAdapter.normalizeIdentity({ providerKey: 'saml', subjectId: 'name-id', claims: { group: 'payments' }, observedAt: 1 }).entitlements)
      .toEqual([{ type: 'authenticated', externalId: 'authenticated' }, { type: 'group', externalId: 'payments' }]);
    expect(ldapIdentityProviderAdapter.normalizeIdentity({ providerKey: 'ldap', subjectId: 'uuid-1', claims: { memberOf: ['CN=Ops,DC=example', 'CN=Ops,DC=example'] }, observedAt: 1 }).entitlements)
      .toEqual([{ type: 'authenticated', externalId: 'authenticated' }, { type: 'group', externalId: 'CN=Ops,DC=example' }]);
  });

  it('preserves an LDAP-backed immutable group identifier when delivered through OIDC or SAML', () => {
    const groupId = 'group-id-platform-operators';
    const normalizedGroups = [oidcIdentityProviderAdapter, samlIdentityProviderAdapter, ldapIdentityProviderAdapter]
      .map((adapter) => adapter.normalizeIdentity({
        providerKey: `${adapter.type}-ldap-backed`, subjectId: 'subject-1', observedAt: 1,
        claims: adapter.type === 'ldap' ? { memberOf: [groupId] } : { groups: [groupId] },
      }).entitlements.filter((entitlement) => entitlement.type === 'group'));

    expect(normalizedGroups).toEqual([
      [{ type: 'group', externalId: groupId }],
      [{ type: 'group', externalId: groupId }],
      [{ type: 'group', externalId: groupId }],
    ]);
  });

  it('emits attributes only from the sanitized authorization attribute block', () => {
    const identity = oidcIdentityProviderAdapter.normalizeIdentity({
      providerKey: 'entra-prod', subjectId: 'oid-1',
      claims: {
        clearance: 'secret',
        __enterpriseglue_authz_attributes: { clearance: ['secret', 'secret'], region: 'eu' },
      },
      observedAt: 10,
    });

    expect(identity.entitlements).toContainEqual({ type: 'attribute', externalId: 'attribute:clearance:secret' });
    expect(identity.entitlements).toContainEqual({ type: 'attribute', externalId: 'attribute:region:eu' });
    expect(identity.entitlements).not.toContainEqual({ type: 'attribute', externalId: 'attribute:clearance:top-secret' });
  });

  it('persists only configured authorization attributes in normalized identity snapshots', () => {
    expect(allowlistedIdentityClaims({ groups: ['ops'], clearance: 'secret', department: 'payments' }, ['clearance'])).toEqual({
      groups: ['ops'],
      __enterpriseglue_authz_attributes: { clearance: ['secret'] },
    });
  });

  it.each([
    { hasgroups: true },
    { groups_overage: true },
    { _claim_names: { groups: 'src1' }, _claim_sources: { src1: { endpoint: 'https://graph.example.test/me/getMemberObjects' } } },
  ])('fails closed when an OIDC response reports incomplete group claims', (claims) => {
    expect(() => oidcIdentityProviderAdapter.normalizeIdentity({
      providerKey: 'entra-prod', subjectId: 'oid-1', claims,
    })).toThrow('OIDC group claims are incomplete');
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
          { type: 'authenticated', externalId: 'authenticated' },
          { type: 'group', externalId: 'group-a' },
          { type: 'group', externalId: 'group-b' },
          { type: 'role', externalId: 'operator' },
          { type: 'scope', externalId: 'engine.read' },
          { type: 'scope', externalId: 'files.read' },
          { type: 'attribute', externalId: 'email_domain:example.com' },
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
        { type: 'authenticated', externalId: 'authenticated' },
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
identityAdapterContract('in-memory-fake', inMemoryIdentityProviderAdapter);
