import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { ldapIdentityProviderAdapter, samlIdentityProviderAdapter } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { MockLdapDirectory, MockOidcProvider, MockSamlIdentityProvider } from '../../../support/identity-mocks.js';

describe('identity mock provider contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs an OIDC discovery, PKCE, token, JWKS, issuer, audience, and nonce contract', async () => {
    const provider = new MockOidcProvider();
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    const request = await genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-1', 'nonce-1');
    expect(new URL(request.url).searchParams.get('code_challenge_method')).toBe('S256');
    const claims = await genericOidcService.exchangeCode(provider.configuration(), { code: 'code-1', codeVerifier: request.codeVerifier, nonce: 'nonce-1' });
    expect(claims).toMatchObject({ sub: 'user-1', email: 'person@example.test', groups: ['ops'] });
  });

  it('normalizes SAML assertion attributes through the same entitlement envelope', () => {
    const assertion = new MockSamlIdentityProvider().assertion();
    const identity = samlIdentityProviderAdapter.normalizeIdentity({ providerKey: 'saml-mock', subjectId: String(assertion.nameID), claims: assertion });
    expect(identity.entitlements).toEqual(expect.arrayContaining([{ type: 'role', externalId: 'operator' }]));
  });

  it('requires an LDAP bind before normalizing immutable group DNs', () => {
    const directory = new MockLdapDirectory();
    expect(() => directory.bind('person@example.test', 'wrong')).toThrow('LDAP invalid credentials');
    const entry = directory.bind('person@example.test', 'directory-password');
    const identity = ldapIdentityProviderAdapter.normalizeIdentity({ providerKey: 'ldap-mock', subjectId: entry.subjectId, claims: { memberOf: entry.memberOf } });
    expect(identity.entitlements).toEqual([{ type: 'group', externalId: 'cn=operations,ou=groups,dc=example,dc=test' }]);
  });
});
