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
