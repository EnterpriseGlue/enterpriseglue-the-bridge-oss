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
  parseInvitationEnrollmentContext,
} from '../../../../../packages/backend-host/src/modules/auth/routes/sso-state.js';
import { signOidcState, signSamlRelayState } from '@enterpriseglue/shared/utils/samlRelayState.js';
import { config } from '@enterpriseglue/shared/config/index.js';

function request(): Request {
  return { params: { tenantSlug: 'acme' }, query: { returnTo: '/t/acme/dashboard' } } as unknown as Request;
}

function encode(timestamp: number): string {
  return Buffer.from(JSON.stringify({ timestamp, nonce: 'nonce' })).toString('base64url');
}

describe('provider-neutral SSO state', () => {
  const enrollment = { invitationId: 'invite-1', userId: 'pending-user', tenantId: 'tenant-1', tenantSlug: 'acme', authSessionVersion: 0 as const };

  it.each(['oidc', 'saml'] as const)('binds exact fresh enrollment references to %s provider state without credentials', (protocol) => {
    const req = request(); req.query.tenantSlug = 'foreign'; req.query.enrollment = 'attacker-context';
    const state = protocol === 'oidc'
      ? buildSignedOidcState(req, 'provider-1', { key: 'identity.main', tenantId: 'tenant-1' }, enrollment)
      : buildSignedSamlState(req, 'provider-1', { key: 'identity.main', tenantId: 'tenant-1' }, createSamlRequestId(), enrollment);
    const parsed = protocol === 'oidc' ? parseSignedOidcState(state) : parseSignedSamlState(state);
    expect(parsed).toMatchObject({ enrollment, tenantSlug: 'acme', providerId: 'provider-1', identityProviderTenantId: 'tenant-1' });
    expect(parsed?.enrollment).not.toBe(enrollment);
    expect(JSON.stringify(parsed)).not.toContain('attacker-context');
  });

  it.each([null, {}, { ...enrollment, authSessionVersion: 1 }, { ...enrollment, userId: '' },
    { ...enrollment, invitationId: '../other' }, { ...enrollment, tenantSlug: 'acme/other' },
    { ...enrollment, onboardingToken: 'must-not-enter-state' }, { ...enrollment, tenantId: 'other' }])('rejects malformed or cross-tenant enrollment instead of downgrading it (%j)', (context) => {
    const raw = Buffer.from(JSON.stringify({ timestamp: Date.now(), nonce: 'nonce', providerId: 'provider-1',
      identityProviderKey: 'identity.main', identityProviderTenantId: 'tenant-1', tenantSlug: 'acme', enrollment: context })).toString('base64url');
    expect(parseSignedOidcState(signOidcState(raw))).toBeNull();
    expect(parseSignedSamlState(signSamlRelayState(raw))).toBeNull();
    expect(() => buildSignedOidcState(request(), 'provider-1', { key: 'identity.main', tenantId: 'tenant-1' }, context as any)).toThrow();
  });

  it('requires complete provider and tenant binding when enrollment is present', () => {
    for (const field of ['providerId', 'identityProviderKey', 'identityProviderTenantId', 'tenantSlug']) {
      const value: Record<string, unknown> = { timestamp: Date.now(), nonce: 'nonce', providerId: 'provider-1', identityProviderKey: 'identity.main', identityProviderTenantId: 'tenant-1', tenantSlug: 'acme', enrollment };
      delete value[field];
      expect(parseSsoState(Buffer.from(JSON.stringify(value)).toString('base64url'))).toBeNull();
    }
    expect(parseInvitationEnrollmentContext({ ...enrollment, authSessionVersion: '0' })).toBeNull();
  });

  it('never promotes query-supplied enrollment into ordinary login state', () => {
    const req = request(); req.query.enrollment = JSON.stringify(enrollment);
    expect(parseSignedOidcState(buildSignedOidcState(req, 'provider-1', { key: 'identity.main', tenantId: 'tenant-1' }))).not.toHaveProperty('enrollment');
  });

  it('binds authenticated account linking to the exact user, tenant, provider, and session version', () => {
    const accountLink = { userId: 'user-1', tenantId: 'tenant-1', authSessionVersion: 7, sessionId: '11111111-2222-4333-8444-555555555555' };
    const parsed = parseSignedOidcState(buildSignedOidcState(
      request(),
      'provider-1',
      { key: 'identity.oidc.main', tenantId: 'tenant-1' },
      undefined,
      accountLink,
    ));

    expect(parsed).toMatchObject({
      tenantSlug: 'acme',
      providerId: 'provider-1',
      identityProviderTenantId: 'tenant-1',
      accountLink,
    });
    expect(parsed).not.toHaveProperty('enrollment');
  });

  it('binds a global Cloud provider link to the exact authenticated tenant session', () => {
    const originalMode = config.tenancyMode;
    const originalCloudIdentity = config.cloudAccountIdentityEnabled;
    config.tenancyMode = 'pooled';
    config.cloudAccountIdentityEnabled = true;
    const accountLink = { userId: 'user-1', tenantId: 'tenant-1', authSessionVersion: 7, sessionId: '11111111-2222-4333-8444-555555555555' };
    try {
      const parsed = parseSignedOidcState(buildSignedOidcState(
        request(),
        'provider-global',
        { key: 'identity.microsoft', tenantId: null },
        undefined,
        accountLink,
      ));

      expect(parsed).toMatchObject({
        tenantSlug: 'acme',
        providerId: 'provider-global',
        identityProviderKey: 'identity.microsoft',
        accountLink,
      });
      expect(parsed).not.toHaveProperty('identityProviderTenantId');
    } finally {
      config.tenancyMode = originalMode;
      config.cloudAccountIdentityEnabled = originalCloudIdentity;
    }
  });

  it('rejects a global provider account-link state when Cloud account identity is disabled', () => {
    const originalMode = config.tenancyMode;
    const originalCloudIdentity = config.cloudAccountIdentityEnabled;
    config.tenancyMode = 'pooled';
    config.cloudAccountIdentityEnabled = false;
    try {
      expect(() => buildSignedOidcState(
        request(),
        'provider-global',
        { key: 'identity.microsoft', tenantId: null },
        undefined,
        { userId: 'user-1', tenantId: 'tenant-1', authSessionVersion: 7, sessionId: '11111111-2222-4333-8444-555555555555' },
      )).toThrow('Invalid account link state');
    } finally {
      config.tenancyMode = originalMode;
      config.cloudAccountIdentityEnabled = originalCloudIdentity;
    }
  });

  it.each([
    null,
    {},
    { userId: 'user-1', tenantId: 'other-tenant', authSessionVersion: 7, sessionId: '11111111-2222-4333-8444-555555555555' },
    { userId: '', tenantId: 'tenant-1', authSessionVersion: 7, sessionId: '11111111-2222-4333-8444-555555555555' },
    { userId: 'user-1', tenantId: 'tenant-1', authSessionVersion: -1, sessionId: '11111111-2222-4333-8444-555555555555' },
    { userId: 'user-1', tenantId: 'tenant-1', authSessionVersion: 7, sessionId: 'not-a-session' },
    { userId: 'user-1', tenantId: 'tenant-1', authSessionVersion: 7, sessionId: '11111111-2222-4333-8444-555555555555', accessToken: 'forbidden' },
  ])('rejects malformed or cross-tenant account-link state (%j)', (accountLink) => {
    const raw = Buffer.from(JSON.stringify({
      timestamp: Date.now(), nonce: 'nonce', providerId: 'provider-1',
      identityProviderKey: 'identity.oidc.main', identityProviderTenantId: 'tenant-1',
      tenantSlug: 'acme', accountLink,
    })).toString('base64url');
    expect(parseSignedOidcState(signOidcState(raw))).toBeNull();
    expect(() => buildSignedOidcState(
      request(),
      'provider-1',
      { key: 'identity.oidc.main', tenantId: 'tenant-1' },
      undefined,
      accountLink as any,
    )).toThrow();
  });
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
