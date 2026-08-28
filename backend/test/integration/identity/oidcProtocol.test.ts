import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';
import { MockOidcHttpsServer } from '../../identity-mocks/index.js';

describe('loopback OIDC protocol mock', () => {
  let server: MockOidcHttpsServer | null = null;

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await server?.stop();
    server = null;
  });

  it('resolves a tenant-bound client secret only with the matching OIDC tenant context', async () => {
    server = new MockOidcHttpsServer();
    await server.start();
    vi.stubGlobal('fetch', server.fetch.bind(server));
    const resolve = vi.spyOn(secretResolver, 'resolveTenantStored').mockResolvedValue('tenant-oidc-secret');
    const configuration = {
      ...server.configuration(),
      clientSecretRef: 'ref:tenant-secret://v1/tenant-alpha/oidc.client_secret/version-1',
    };

    await expect(genericOidcService.exchangeCode(configuration, {
      code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1',
    }, { tenantId: 'tenant-alpha', correlationId: 'oidc-tenant-secret-test' })).resolves.toMatchObject({ sub: 'user-1' });
    expect(resolve).toHaveBeenCalledWith(configuration.clientSecretRef, {
      tenantId: 'tenant-alpha', purpose: 'oidc.client_secret', correlationId: 'oidc-tenant-secret-test',
    });
  });

  it('serves discovery, authorization, token, JWKS, userinfo, and groups on an ephemeral loopback port', async () => {
    server = new MockOidcHttpsServer();
    await server.start();
    vi.stubGlobal('fetch', server.fetch.bind(server));

    const configuration = server.configuration();
    const request = await genericOidcService.createAuthorizationRequest(configuration, 'state-1', 'nonce-1');
    expect(new URL(request.url).origin).toBe(server.issuer);
    expect(new URL(request.url).searchParams.get('code_challenge_method')).toBe('S256');

    const authorization = await fetch(request.url, { redirect: 'manual' });
    expect(authorization.status).toBe(302);
    expect(authorization.headers.get('location')).toContain('code=code-1');
    expect(authorization.headers.get('location')).toContain('state=state-1');

    const claims = await genericOidcService.exchangeCode(configuration, {
      code: 'code-1', codeVerifier: request.codeVerifier, nonce: 'nonce-1',
    });
    expect(claims).toMatchObject({ sub: 'user-1', groups: ['ops'] });

    await expect((await fetch(`${server.issuer}/userinfo`)).json()).resolves.toMatchObject({ sub: 'user-1' });
    await expect((await fetch(`${server.issuer}/groups`)).json()).resolves.toEqual({ groups: ['ops'], roles: [] });
  });

  it('changes groups and roles through the in-process controller between OIDC exchanges', async () => {
    server = new MockOidcHttpsServer();
    await server.start();
    vi.stubGlobal('fetch', server.fetch.bind(server));
    server.provider!.setTokenClaims({
      sub: 'user-1', email: 'person@example.test', email_verified: true,
      groups: ['operations', 'payments'], roles: ['operator'], nonce: 'nonce-2',
    });

    const claims = await genericOidcService.exchangeCode(server.configuration(), {
      code: 'code-2', codeVerifier: 'verifier-2', nonce: 'nonce-2',
    });

    expect(claims).toMatchObject({ groups: ['operations', 'payments'], roles: ['operator'] });
  });
});
