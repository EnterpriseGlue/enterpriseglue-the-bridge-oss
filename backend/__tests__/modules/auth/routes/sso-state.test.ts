import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  buildSignedSamlState,
  buildSignedOidcState,
  buildSsoState,
  createSamlRequestId,
  parseSignedSamlState,
  parseSignedOidcState,
  parseSsoState,
} from '../../../../../packages/backend-host/src/modules/auth/routes/sso-state.js';

function request(): Request {
  return { params: { tenantSlug: 'acme' }, query: { returnTo: '/t/acme/dashboard' } } as unknown as Request;
}

function encode(timestamp: number): string {
  return Buffer.from(JSON.stringify({ timestamp, nonce: 'nonce' })).toString('base64url');
}

describe('provider-neutral SSO state', () => {
  it('uses independent cryptographic nonces and preserves safe tenant return state', () => {
    const first = parseSsoState(buildSsoState(request(), 'provider-1', { key: 'identity.oidc.main', tenantId: 'tenant-1' }));
    const second = parseSsoState(buildSsoState(request(), 'provider-1', { key: 'identity.oidc.main', tenantId: 'tenant-1' }));
    expect(first?.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second?.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first?.nonce).not.toBe(second?.nonce);
    expect(first?.returnTo).toBe('/t/acme/dashboard');
  });

  it('signs OIDC tenant/provider state with a protocol-specific audience', () => {
    const oidc = buildSignedOidcState(request(), 'provider-1', { key: 'identity.oidc.main', tenantId: 'tenant-1' });
    const parsed = parseSignedOidcState(oidc);
    expect(parsed).toMatchObject({ providerId: 'provider-1', identityProviderKey: 'identity.oidc.main', identityProviderTenantId: 'tenant-1' });

    const replacement = oidc.endsWith('A') ? 'B' : 'A';
    expect(parseSignedOidcState(`${oidc.slice(0, -1)}${replacement}`)).toBeNull();

    const saml = buildSignedSamlState(request(), 'provider-1', { key: 'identity.saml.main', tenantId: 'tenant-1' }, createSamlRequestId());
    expect(parseSignedOidcState(saml)).toBeNull();
    expect(parseSignedSamlState(oidc)).toBeNull();
  });

  it('binds verified-hostname SSO starts to the resolved tenant', () => {
    const hostnameRequest = {
      params: {},
      query: {},
      tenant: { tenantId: 'tenant-1', tenantSlug: 'acme' },
    } as unknown as Request;

    const parsed = parseSignedOidcState(buildSignedOidcState(
      hostnameRequest,
      'provider-1',
      { key: 'identity.oidc.main', tenantId: 'tenant-1' },
    ));

    expect(parsed).toMatchObject({
      tenantSlug: 'acme',
      identityProviderTenantId: 'tenant-1',
    });
  });

  it('rejects expired and materially future-dated state', () => {
    expect(parseSsoState(encode(Date.now() - 10 * 60 * 1000 - 1))).toBeNull();
    expect(parseSsoState(encode(Date.now() + 2 * 60 * 1000))).toBeNull();
  });

  it('binds SAML RelayState integrity to a cryptographic request id', () => {
    const requestId = createSamlRequestId();
    const state = buildSignedSamlState(request(), 'provider-1', { key: 'identity.saml.main', tenantId: 'tenant-1' }, requestId);
    expect(requestId).toMatch(/^_[A-Za-z0-9_-]{43}$/);
    expect(parseSignedSamlState(state)?.samlRequestId).toBe(requestId);
    const replacement = state.endsWith('A') ? 'B' : 'A';
    expect(parseSignedSamlState(`${state.slice(0, -1)}${replacement}`)).toBeNull();
  });
});
