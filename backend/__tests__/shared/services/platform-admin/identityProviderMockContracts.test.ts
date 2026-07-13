import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { ldapIdentityProviderAdapter, oidcIdentityProviderAdapter, samlIdentityProviderAdapter } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { MockLdapDirectory, MockOidcProvider, MockSamlIdentityProvider } from '../../../../test/identity-mocks/index.js';

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

  it('accepts a token signed with rotated provider key material', async () => {
    const provider = new MockOidcProvider();
    provider.rotateSigningMaterial();
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).resolves.toMatchObject({ sub: 'user-1' });
  });

  it.each([
    ['unavailable', 'OIDC discovery request failed (503)'],
    ['malformed', 'OIDC authorization endpoint must be a valid URL'],
    ['wrong_issuer', 'OIDC discovery issuer does not match the configured issuer'],
  ] as const)('fails closed for %s discovery responses', async (failureMode, message) => {
    const provider = new MockOidcProvider();
    provider.setFailureMode(failureMode);
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    await expect(genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-1', 'nonce-1')).rejects.toThrow(message);
  });

  it('fails closed for an invalid ID token returned by the provider', async () => {
    const provider = new MockOidcProvider();
    provider.setFailureMode('invalid_token');
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).rejects.toThrow('OIDC ID token header is invalid');
  });

  it('emits an Entra-style group-overage marker that authorization rejects before synchronization', async () => {
    const provider = new MockOidcProvider();
    provider.setFailureMode('group_overage');
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    const claims = await genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    });

    expect(() => oidcIdentityProviderAdapter.normalizeIdentity({
      providerKey: 'entra-mock', subjectId: claims.sub, claims,
    })).toThrow('OIDC group claims are incomplete');
  });

  it.each([
    ['wrong_audience', 'jwt audience invalid. expected: enterpriseglue-test-client'],
    ['expired_token', 'jwt expired'],
    ['not_yet_valid_token', 'jwt not active'],
    ['missing_subject', 'OIDC ID token subject or nonce is invalid'],
  ] as const)('fails closed when the OIDC fixture returns %s', async (failureMode, message) => {
    const provider = new MockOidcProvider();
    provider.setFailureMode(failureMode);
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).rejects.toThrow(message);
  });

  it('surfaces an OIDC provider timeout without continuing authorization', async () => {
    const provider = new MockOidcProvider();
    provider.setFailureMode('timeout');
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    await expect(genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-1', 'nonce-1'))
      .rejects.toThrow('OIDC provider request timed out');
  });
});
