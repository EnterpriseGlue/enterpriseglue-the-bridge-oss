import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import samlRouter from '../../../../../packages/backend-host/src/modules/auth/routes/saml.js';
import samlStartRouter from '../../../../../packages/backend-host/src/modules/auth/routes/saml-start.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import {
  isSamlAuthEnabled,
  getSamlAuthorizationUrl,
  validateSamlPostResponse,
  extractSamlUserInfo,
  provisionSamlUser,
} from '@enterpriseglue/shared/services/saml.js';

const samlAssertionReplayService = vi.hoisted(() => ({ consume: vi.fn() }));

vi.mock('@enterpriseglue/shared/services/saml.js', () => ({
  getSamlStatus: vi.fn().mockResolvedValue({ enabled: true }),
  isSamlAuthEnabled: vi.fn().mockResolvedValue(true),
  getSamlAuthorizationUrl: vi.fn(),
  validateSamlPostResponse: vi.fn(),
  extractSamlUserInfo: vi.fn(),
  provisionSamlUser: vi.fn(),
  generateSamlServiceProviderMetadata: vi.fn().mockResolvedValue('<xml />'),
}));

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  generateAccessToken: vi.fn().mockReturnValue('saml-access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('saml-refresh-token'),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SamlAssertionReplayService.js', () => ({ samlAssertionReplayService }));

function getCookieValue(setCookieHeader: string[] | undefined, cookieName: string): string | null {
  if (!setCookieHeader || setCookieHeader.length === 0) return null;

  for (const rawCookie of setCookieHeader) {
    const [pair] = rawCookie.split(';');
    const [name, value] = pair.split('=');
    if (name === cookieName) {
      if (!value) return null;
      return decodeURIComponent(value);
    }
  }

  return null;
}

function getSetCookieHeader(headers: Record<string, unknown>): string[] | undefined {
  const raw = headers['set-cookie'];
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string');
  }
  if (typeof raw === 'string') {
    return [raw];
  }
  return undefined;
}

const testCookieParser: express.RequestHandler = (req, _res, next) => {
  const cookieHeader = req.headers.cookie;
  const cookies: Record<string, string> = Object.create(null);

  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [nameRaw, ...rest] = part.trim().split('=');
      if (!nameRaw || nameRaw === '__proto__' || nameRaw === 'constructor' || nameRaw === 'prototype') continue;
      cookies[nameRaw] = decodeURIComponent(rest.join('=') || '');
    }
  }

  (req as any).cookies = cookies;
  next();
};

describe('SAML auth flow e2e harness', () => {
  let app: express.Application;
  let ssoProvisionedHook: Mock;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    ssoProvisionedHook = vi.fn().mockResolvedValue(undefined);
    app.locals.onSsoUserProvisioned = ssoProvisionedHook;
    app.use(testCookieParser);
    app.use(samlRouter);
    app.use(samlStartRouter);
    app.use(errorHandler);

    vi.clearAllMocks();

    (isSamlAuthEnabled as unknown as Mock).mockResolvedValue(true);
    (getSamlAuthorizationUrl as unknown as Mock).mockImplementation(async (relayState: string) => ({
      url: `https://idp.example.com/sso?RelayState=${encodeURIComponent(relayState)}`,
      entryPoint: 'https://idp.example.com/sso',
    }));

    const profile = {
      email: 'saml-user@example.com',
      oid: 'oid-123',
      groups: ['ops'],
      roles: ['admin'],
    };

    const userInfo = {
      email: 'saml-user@example.com',
      oid: 'oid-123',
      tid: 'tenant-123',
      name: 'Saml User',
      given_name: 'Saml',
      family_name: 'User',
      groups: ['ops'],
      roles: ['admin'],
      nameId: 'saml-user@example.com',
      customClaims: {},
    };

    (validateSamlPostResponse as unknown as Mock).mockResolvedValue({
      profile,
      providerId: 'provider-saml-1',
    });
    (extractSamlUserInfo as unknown as Mock).mockReturnValue(userInfo);
    (provisionSamlUser as unknown as Mock).mockResolvedValue({
      id: 'user-1',
      email: 'saml-user@example.com',
      platformRole: 'admin',
      isActive: true,
    });
    samlAssertionReplayService.consume.mockResolvedValue(undefined);
  });

  it('completes start -> callback flow and sets auth cookies', async () => {
    const agent = request.agent(app);

    const initResponse = await agent.get('/api/auth/saml');
    expect(initResponse.status).toBe(302);
    expect(initResponse.headers.location).toBe('/api/auth/saml/start');

    const startResponse = await agent.get('/api/auth/saml/start');
    expect(startResponse.status).toBe(302);
    expect(startResponse.headers.location).toContain('https://idp.example.com/sso');

    const relayState = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    expect(relayState).toBeTruthy();
    expect(getSamlAuthorizationUrl as unknown as Mock).toHaveBeenCalledWith(relayState);

    const callbackResponse = await agent
      .post('/api/auth/saml/callback')
      .type('form')
      .send({
        SAMLResponse: 'mock-saml-response',
        RelayState: relayState,
      });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe(`${config.frontendUrl}/`);

    const setCookies = getSetCookieHeader(callbackResponse.headers);
    expect(setCookies?.some((cookie) => cookie.startsWith('accessToken='))).toBe(true);
    expect(setCookies?.some((cookie) => cookie.startsWith('refreshToken='))).toBe(true);
    expect(setCookies?.some((cookie) => cookie.startsWith('oauth_state='))).toBe(true);

    expect(validateSamlPostResponse as unknown as Mock).toHaveBeenCalledWith('mock-saml-response');
    expect(samlAssertionReplayService.consume).toHaveBeenCalledWith({ providerId: 'provider-saml-1', samlResponse: 'mock-saml-response' });
    expect(extractSamlUserInfo as unknown as Mock).toHaveBeenCalledTimes(1);
    expect(provisionSamlUser as unknown as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'saml-user@example.com', oid: 'oid-123' }),
      'provider-saml-1'
    );
    expect(ssoProvisionedHook).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'saml',
      providerId: 'provider-saml-1',
      tenantSlug: null,
      returnTo: '/',
      user: expect.objectContaining({ id: 'user-1' }),
      userInfo: expect.objectContaining({ email: 'saml-user@example.com' }),
    }));
  });

  it('preserves tenant context through mocked Entra SAML start -> callback flow', async () => {
    const agent = request.agent(app);

    const initResponse = await agent.get('/api/auth/saml').query({ tenantSlug: 'default' });
    expect(initResponse.status).toBe(302);
    expect(initResponse.headers.location).toBe('/api/auth/saml/start?tenantSlug=default');

    const startResponse = await agent.get(initResponse.headers.location);
    expect(startResponse.status).toBe(302);
    expect(startResponse.headers.location).toContain('https://idp.example.com/sso');

    const relayState = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    expect(relayState).toBeTruthy();
    expect(getSamlAuthorizationUrl as unknown as Mock).toHaveBeenCalledWith(relayState);

    const callbackResponse = await agent
      .post('/api/auth/saml/callback')
      .type('form')
      .send({
        SAMLResponse: 'mock-saml-response',
        RelayState: relayState,
      });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe(`${config.frontendUrl}/t/default/`);
    expect(ssoProvisionedHook).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'saml',
      providerId: 'provider-saml-1',
      tenantSlug: 'default',
      returnTo: '/t/default/',
    }));
  });

  it('binds an explicit SAML provider id through start and callback', async () => {
    const agent = request.agent(app);
    const providerId = 'provider-saml-2';

    const initResponse = await agent.get('/api/auth/saml').query({ providerId });
    expect(initResponse.status).toBe(302);
    expect(initResponse.headers.location).toBe(`/api/auth/saml/start?providerId=${providerId}`);

    const startResponse = await agent.get(initResponse.headers.location);
    const relayState = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    expect(startResponse.status).toBe(302);
    expect(getSamlAuthorizationUrl as unknown as Mock).toHaveBeenCalledWith(relayState, providerId);

    const callbackResponse = await agent
      .post('/api/auth/saml/callback')
      .type('form')
      .send({ SAMLResponse: 'mock-saml-response', RelayState: relayState });

    expect(callbackResponse.status).toBe(302);
    expect(validateSamlPostResponse as unknown as Mock).toHaveBeenCalledWith('mock-saml-response', providerId);
  });

  it('rejects a mocked SAML authorization URL whose host differs from the configured IdP', async () => {
    (getSamlAuthorizationUrl as unknown as Mock).mockResolvedValueOnce({
      url: 'https://attacker.example.com/sso',
      entryPoint: 'https://idp.example.com/sso',
    });

    const response = await request(app).get('/api/auth/saml/start');

    expect(response.status).toBe(500);
    expect(response.body).toEqual(expect.objectContaining({
      error: 'Failed to initiate SAML authentication',
      code: 'INTERNAL_ERROR',
    }));
  });

  it('rejects callback when relay state does not match cookie', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/saml/start');

    const callbackResponse = await agent
      .post('/api/auth/saml/callback')
      .type('form')
      .send({
        SAMLResponse: 'mock-saml-response',
        RelayState: 'tampered-state',
      });

    expect(callbackResponse.status).toBe(400);
    expect(callbackResponse.body).toEqual({ error: 'Invalid relay state' });
    expect(validateSamlPostResponse as unknown as Mock).not.toHaveBeenCalled();
    expect(ssoProvisionedHook).not.toHaveBeenCalled();
  });

  it('redirects without provisioning when a legacy SAML assertion was already consumed', async () => {
    const agent = request.agent(app);
    const startResponse = await agent.get('/api/auth/saml/start');
    const relayState = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    samlAssertionReplayService.consume.mockRejectedValueOnce(new Error('SAML assertion has already been used'));

    const callbackResponse = await agent
      .post('/api/auth/saml/callback')
      .type('form')
      .send({ SAMLResponse: 'mock-saml-response', RelayState: relayState });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toContain('error=saml_auth_failed');
    expect(provisionSamlUser as unknown as Mock).not.toHaveBeenCalled();
  });

  it('redirects to login error when provisioned user is deactivated', async () => {
    const agent = request.agent(app);

    const startResponse = await agent.get('/api/auth/saml/start');
    const relayState = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');

    (provisionSamlUser as unknown as Mock).mockResolvedValueOnce({
      id: 'user-1',
      email: 'saml-user@example.com',
      platformRole: 'admin',
      isActive: false,
    });

    const callbackResponse = await agent
      .post('/api/auth/saml/callback')
      .type('form')
      .send({
        SAMLResponse: 'mock-saml-response',
        RelayState: relayState,
      });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe(
      `${config.frontendUrl}/login?error=account_deactivated&message=${encodeURIComponent('Your account has been deactivated')}`
    );

    const setCookies = getSetCookieHeader(callbackResponse.headers);
    expect(setCookies?.some((cookie) => cookie.startsWith('accessToken='))).toBe(false);
    expect(setCookies?.some((cookie) => cookie.startsWith('refreshToken='))).toBe(false);
    expect(ssoProvisionedHook).not.toHaveBeenCalled();
  });
});
