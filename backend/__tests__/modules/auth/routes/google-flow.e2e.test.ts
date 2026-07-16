import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import googleRouter from '../../../../../packages/backend-host/src/modules/auth/routes/google.js';
import googleStartRouter from '../../../../../packages/backend-host/src/modules/auth/routes/google-start.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import {
  isGoogleAuthEnabled,
  getGoogleAuthorizationUrl,
  exchangeGoogleCodeForTokens,
  extractGoogleUserInfo,
  provisionGoogleUser,
} from '@enterpriseglue/shared/services/google.js';

const authSessionService = vi.hoisted(() => ({ issue: vi.fn() }));

vi.mock('@enterpriseglue/shared/services/google.js', () => ({
  isGoogleAuthEnabled: vi.fn().mockResolvedValue(true),
  getGoogleAuthorizationUrl: vi.fn(),
  exchangeGoogleCodeForTokens: vi.fn(),
  extractGoogleUserInfo: vi.fn(),
  provisionGoogleUser: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/AuthSessionService.js', () => ({ authSessionService }));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  },
}));

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

describe('Google OAuth flow e2e harness', () => {
  let app: express.Application;
  let ssoProvisionedHook: Mock;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(testCookieParser);
    app.use(googleRouter);
    app.use(googleStartRouter);
    app.use(errorHandler);
    ssoProvisionedHook = vi.fn().mockResolvedValue(undefined);
    app.locals.onSsoUserProvisioned = ssoProvisionedHook;

    vi.clearAllMocks();

    (isGoogleAuthEnabled as unknown as Mock).mockResolvedValue(true);
    (getGoogleAuthorizationUrl as unknown as Mock).mockImplementation(async (state: string) => (
      `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`
    ));
    (exchangeGoogleCodeForTokens as unknown as Mock).mockResolvedValue({
      payload: {
        sub: 'google-123',
        email: 'google-user@example.com',
        name: 'Google User',
      },
    });
    (extractGoogleUserInfo as unknown as Mock).mockReturnValue({
      sub: 'google-123',
      email: 'google-user@example.com',
      name: 'Google User',
    });
    (provisionGoogleUser as unknown as Mock).mockResolvedValue({
      id: 'user-1',
      email: 'google-user@example.com',
      platformRole: 'admin',
      isActive: true,
    });
    authSessionService.issue.mockResolvedValue({ accessToken: 'google-access-token', refreshToken: 'google-refresh-token', expiresIn: 900 });
  });

  it('completes google start -> callback flow and sets auth cookies', async () => {
    const agent = request.agent(app);

    const initResponse = await agent.get('/api/auth/google');
    expect(initResponse.status).toBe(302);
    expect(initResponse.headers.location).toBe('/api/auth/google/start');

    const startResponse = await agent.get('/api/auth/google/start');
    expect(startResponse.status).toBe(302);
    expect(startResponse.headers.location).toContain('https://accounts.google.com');

    const state = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    expect(state).toBeTruthy();
    expect(getGoogleAuthorizationUrl as unknown as Mock).toHaveBeenCalledWith(state);

    const callbackResponse = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe(`${config.frontendUrl}/`);

    const setCookies = getSetCookieHeader(callbackResponse.headers);
    expect(setCookies?.some((cookie) => cookie.startsWith('accessToken='))).toBe(true);
    expect(setCookies?.some((cookie) => cookie.startsWith('refreshToken='))).toBe(true);
    expect(setCookies?.some((cookie) => cookie.startsWith('oauth_state='))).toBe(true);

    expect(exchangeGoogleCodeForTokens as unknown as Mock).toHaveBeenCalledWith('auth-code');
    expect(provisionGoogleUser as unknown as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'google-user@example.com', sub: 'google-123' })
    );
    expect(ssoProvisionedHook).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
      tenantSlug: null,
      returnTo: '/',
      user: expect.objectContaining({ id: 'user-1' }),
    }));
    expect(authSessionService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', email: 'google-user@example.com' }),
      expect.objectContaining({ identityProviderId: null }),
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.not.objectContaining({ googleId: expect.anything() }),
    }));
  });

  it('preserves tenant context through Google start and callback', async () => {
    const agent = request.agent(app);

    const initResponse = await agent.get('/api/auth/google?tenantSlug=default');
    expect(initResponse.status).toBe(302);
    expect(initResponse.headers.location).toBe('/api/auth/google/start?tenantSlug=default');

    const startResponse = await agent.get(initResponse.headers.location);
    expect(startResponse.status).toBe(302);
    const state = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    expect(state).toBeTruthy();
    expect(getGoogleAuthorizationUrl as unknown as Mock).toHaveBeenCalledWith(state);

    const callbackResponse = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe(`${config.frontendUrl}/t/default/`);
    expect(ssoProvisionedHook).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
      tenantSlug: 'default',
      returnTo: '/t/default/',
    }));
  });

  it('binds a selected legacy Google provider through start, callback, and reconciliation', async () => {
    const agent = request.agent(app);

    const initResponse = await agent.get('/api/auth/google').query({ providerId: 'legacy-google-1' });
    expect(initResponse.status).toBe(302);
    expect(initResponse.headers.location).toBe('/api/auth/google/start?providerId=legacy-google-1');

    const startResponse = await agent.get(initResponse.headers.location);
    const state = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    expect(state).toBeTruthy();
    expect(isGoogleAuthEnabled as unknown as Mock).toHaveBeenCalledWith('legacy-google-1');
    expect(getGoogleAuthorizationUrl as unknown as Mock).toHaveBeenCalledWith(state, 'legacy-google-1');

    const callbackResponse = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state });

    expect(callbackResponse.status).toBe(302);
    expect(exchangeGoogleCodeForTokens as unknown as Mock).toHaveBeenCalledWith('auth-code', 'legacy-google-1');
    expect(provisionGoogleUser as unknown as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'google-123' }),
      'legacy-google-1',
    );
    expect(ssoProvisionedHook).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
      providerId: 'legacy-google-1',
    }));
    expect(authSessionService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ identityProviderId: 'legacy-google-1' }),
    );
  });

  it('rejects callback when state does not match cookie', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/google/start');

    const callbackResponse = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: 'tampered-state' });

    expect(callbackResponse.status).toBe(400);
    expect(callbackResponse.body).toEqual({ error: 'Invalid state parameter' });
    expect(exchangeGoogleCodeForTokens as unknown as Mock).not.toHaveBeenCalled();
  });

  it('does not reflect provider error descriptions into the login redirect', async () => {
    const response = await request(app)
      .get('/api/auth/google/callback')
      .query({ error: 'access_denied', error_description: '<token>raw-provider-detail</token>' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      `${config.frontendUrl}/login?error=google_auth_failed&message=${encodeURIComponent('Google authentication was rejected')}`,
    );
    expect(response.headers.location).not.toContain('raw-provider-detail');
  });

  it('redirects to login error when provisioned user is deactivated', async () => {
    const agent = request.agent(app);

    const startResponse = await agent.get('/api/auth/google/start');
    const state = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');

    (provisionGoogleUser as unknown as Mock).mockResolvedValueOnce({
      id: 'user-1',
      email: 'google-user@example.com',
      platformRole: 'admin',
      isActive: false,
    });

    const callbackResponse = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe(
      `${config.frontendUrl}/login?error=account_deactivated&message=${encodeURIComponent('Your account has been deactivated')}`
    );

    const setCookies = getSetCookieHeader(callbackResponse.headers);
    expect(setCookies?.some((cookie) => cookie.startsWith('accessToken='))).toBe(false);
    expect(setCookies?.some((cookie) => cookie.startsWith('refreshToken='))).toBe(false);
  });
});
