import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { ldapIdentityProviderAdapter, oidcIdentityProviderAdapter, samlIdentityProviderAdapter } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderAdapter.js';
import { MockEntraOidcProvider, MockIdentityTestStack, MockLdapDirectory, MockOidcProvider, MockSamlIdentityProvider } from '../../../../test/identity-mocks/index.js';

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

  it('normalizes a deterministic Entra-compatible OIDC profile with immutable IDs, groups, and app roles', async () => {
    const provider = new MockEntraOidcProvider();
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    const request = await genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-1', 'nonce-1');
    const claims = await genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: request.codeVerifier, nonce: 'nonce-1',
    });
    const identity = oidcIdentityProviderAdapter.normalizeIdentity({
      providerKey: 'entra-compatibility',
      subjectId: claims.sub,
      email: claims.email,
      username: claims.preferred_username,
      directoryTenantId: claims.tid,
      claims,
    });

    expect(provider.configuration()).toMatchObject({
      issuerUrl: `https://login.microsoftonline.com/${provider.tenantId}/v2.0`,
      expectedAudience: provider.clientId,
    });
    expect(claims).toMatchObject({
      oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tid: provider.tenantId,
      preferred_username: 'entra-operator@example.test',
      groups: ['group-id-operators'],
      roles: ['enterpriseglue.engine_operator'],
    });
    expect(identity).toMatchObject({
      subjectId: 'entra-subject-1',
      directoryTenantId: provider.tenantId,
      entitlements: expect.arrayContaining([
        { type: 'group', externalId: 'group-id-operators' },
        { type: 'role', externalId: 'enterpriseglue.engine_operator' },
      ]),
    });
  });

  it('emulates an Entra guest login with a PKCE-bound one-time authorization code', async () => {
    const provider = new MockEntraOidcProvider();
    provider.setScenario('guest_user');
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    const request = await genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-guest', 'nonce-1');
    const callback = provider.authorize(request.url);
    const code = callback.searchParams.get('code');
    expect(callback.searchParams.get('state')).toBe('state-guest');
    expect(code).toMatch(/^entra-code-/);

    const claims = await genericOidcService.exchangeCode(provider.configuration(), {
      code: code!, codeVerifier: request.codeVerifier, nonce: 'nonce-1',
    });
    expect(claims).toMatchObject({
      tid: provider.tenantId,
      oid: 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb',
      idp: `https://login.microsoftonline.com/${provider.guestHomeTenantId}/v2.0`,
      roles: ['enterpriseglue.engine_operator'],
    });
    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: code!, codeVerifier: request.codeVerifier, nonce: 'nonce-1',
    })).rejects.toThrow('OIDC token exchange failed (400)');

    const incorrectPkceRequest = await genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-pkce', 'nonce-pkce');
    const incorrectPkceCallback = provider.authorize(incorrectPkceRequest.url);
    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: incorrectPkceCallback.searchParams.get('code')!, codeVerifier: 'not-the-request-verifier', nonce: 'nonce-pkce',
    })).rejects.toThrow('OIDC token exchange failed (400)');
  });

  it('emulates Entra consent denial without issuing an authorization code', async () => {
    const provider = new MockEntraOidcProvider();
    provider.setScenario('consent_denied');
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    const request = await genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-consent', 'nonce-1');
    const callback = provider.authorize(request.url);
    expect(callback.searchParams.get('state')).toBe('state-consent');
    expect(callback.searchParams.get('code')).toBeNull();
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('error_description')).toContain('AADSTS65004');
  });

  it('normalizes SAML assertion attributes through the same entitlement envelope', () => {
    const assertion = new MockSamlIdentityProvider().assertion();
    const identity = samlIdentityProviderAdapter.normalizeIdentity({ providerKey: 'saml-mock', subjectId: String(assertion.nameID), claims: assertion });
    expect(identity.entitlements).toEqual(expect.arrayContaining([{ type: 'role', externalId: 'operator' }]));
  });

  it('requires an LDAP bind before normalizing immutable group DNs', () => {
    const directory = new MockLdapDirectory();
    expect(() => directory.bind('person@example.test', 'wrong')).toThrow('LDAP invalid credentials');
    const entry = directory.bind('person@example.test', directory.defaultUserPassword);
    const identity = ldapIdentityProviderAdapter.normalizeIdentity({ providerKey: 'ldap-mock', subjectId: entry.subjectId, claims: { memberOf: entry.memberOf } });
    expect(identity.entitlements).toEqual(expect.arrayContaining([
      { type: 'authenticated', externalId: 'authenticated' },
      { type: 'group', externalId: 'cn=operations,ou=groups,dc=example,dc=test' },
    ]));
  });

  it('resets coordinated OIDC, SAML, and LDAP fixture state between tests', async () => {
    const stack = new MockIdentityTestStack();
    const { oidc, saml, ldap: directory } = stack;
    oidc.setFailureMode('unavailable');
    oidc.setTokenClaims({ sub: 'changed-user', email: 'changed@example.test', nonce: 'changed-nonce', groups: ['changed'] });
    const rotatedToken = oidc.issueIdToken();
    saml.setAttributes({ nameID: 'changed@example.test', role: ['changed'] });
    saml.setNow(new Date('2030-01-01T00:00:00.000Z'));
    stack.samlReplayCache.consume('saml-provider-1', 'changed-signed-assertion', 1_000);
    expect(() => stack.samlReplayCache.consume('saml-provider-1', 'changed-signed-assertion', 1_001)).toThrow('already been used');
    const previousBindPassword = directory.bindPassword;
    const removedUserPassword = directory.defaultUserPassword;
    directory.setUser('changed@example.test', {
      password: removedUserPassword, subjectId: 'uid=changed,ou=users,dc=example,dc=test', memberOf: [],
    });
    directory.setFailureMode('timeout');

    stack.reset();

    vi.stubGlobal('fetch', oidc.fetch.bind(oidc));
    await expect(genericOidcService.exchangeCode(oidc.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).resolves.toMatchObject({ sub: 'user-1', groups: ['ops'] });
    expect(oidc.issueIdToken()).not.toBe(rotatedToken);
    expect(saml.assertion()).toMatchObject({ nameID: 'person@example.test', role: ['operator'] });
    expect(Buffer.from(saml.signedResponse(), 'base64').toString('utf8')).not.toContain('2030-01-01T00:00:00.000Z');
    expect(directory.bindPassword).not.toBe(previousBindPassword);
    expect(() => directory.bind('changed@example.test', removedUserPassword)).toThrow('LDAP invalid credentials');
    expect(directory.bind('person@example.test', directory.defaultUserPassword)).toMatchObject({ subjectId: expect.stringContaining('uid=person') });
    expect(() => stack.samlReplayCache.consume('saml-provider-1', 'changed-signed-assertion', 1_002)).not.toThrow();
  });

  it('expires a replay entry before accepting the same SAML response again', () => {
    const stack = new MockIdentityTestStack();
    stack.samlReplayCache.consume('saml-provider-1', 'signed-assertion', 1_000, 10);

    expect(() => stack.samlReplayCache.consume('saml-provider-1', 'signed-assertion', 1_009, 10)).toThrow('already been used');
    expect(() => stack.samlReplayCache.consume('saml-provider-1', 'signed-assertion', 1_010, 10)).not.toThrow();
  });

  it('accepts Entra signing-key rotation and rejects a token from its retired JWKS key', async () => {
    const provider = new MockEntraOidcProvider();
    provider.rotateSigningMaterial();
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).resolves.toMatchObject({ sub: 'entra-subject-1' });
    provider.rotateSigningMaterial();
    provider.setFailureMode('unknown_signing_key');
    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-2', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).rejects.toThrow('OIDC signing key was not found in the provider JWKS');
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
    const provider = new MockEntraOidcProvider();
    provider.setScenario('group_overage');
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
    ['multi_audience_missing_azp', 'OIDC ID token with multiple audiences must include an authorized party'],
    ['wrong_azp', 'OIDC ID token authorized party does not match the configured client'],
    ['expired_token', 'jwt expired'],
    ['not_yet_valid_token', 'jwt not active'],
    ['missing_subject', 'OIDC ID token subject is invalid'],
  ] as const)('fails closed when the OIDC fixture returns %s', async (failureMode, message) => {
    const provider = new MockOidcProvider();
    provider.setFailureMode(failureMode);
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).rejects.toThrow(message);
  });

  it('accepts a multi-audience ID token only when azp matches the configured client', async () => {
    const provider = new MockOidcProvider();
    provider.setFailureMode('matching_azp');
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    await expect(genericOidcService.exchangeCode(provider.configuration(), {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    })).resolves.toMatchObject({ sub: 'user-1', azp: provider.clientId });
  });

  it('surfaces an OIDC provider timeout without continuing authorization', async () => {
    const provider = new MockOidcProvider();
    provider.setFailureMode('timeout');
    vi.stubGlobal('fetch', provider.fetch.bind(provider));

    await expect(genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-1', 'nonce-1'))
      .rejects.toThrow('OIDC provider request timed out');
  });

  it('classifies OIDC provider failures without exposing protocol payloads', async () => {
    const cases = [
      ['unavailable', 'provider_unavailable'],
      ['malformed', 'malformed_response'],
      ['invalid_token', 'invalid_signature'],
      ['missing_subject', 'missing_subject'],
      ['timeout', 'timeout'],
    ] as const;

    for (const [failureMode, code] of cases) {
      const provider = new MockOidcProvider();
      provider.setFailureMode(failureMode);
      vi.stubGlobal('fetch', provider.fetch.bind(provider));
      const operation = failureMode === 'invalid_token' || failureMode === 'missing_subject'
        ? genericOidcService.exchangeCode(provider.configuration(), { code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1' })
        : genericOidcService.createAuthorizationRequest(provider.configuration(), 'state-1', 'nonce-1');
      await expect(operation).rejects.toMatchObject({ code });
    }
  });
});
