import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import googleRouter from '../../../../src/modules/auth/routes/google.js';
import googleStartRouter from '../../../../src/modules/auth/routes/google-start.js';
import { errorHandler } from '../../../../src/shared/middleware/errorHandler.js';
import { config } from '../../../../src/shared/config/index.js';
import {
  isGoogleAuthEnabled,
  getGoogleAuthorizationUrl,
  exchangeGoogleCodeForTokens,
  extractGoogleUserInfo,
  provisionGoogleUser,
} from '@shared/services/google.js';

vi.mock('@shared/services/google.js', () => ({
  isGoogleAuthEnabled: vi.fn().mockResolvedValue(true),
  getGoogleAuthorizationUrl: vi.fn(),
  exchangeGoogleCodeForTokens: vi.fn(),
  extractGoogleUserInfo: vi.fn(),
  provisionGoogleUser: vi.fn(),
}));

vi.mock('@shared/utils/jwt.js', () => ({
  generateAccessToken: vi.fn().mockReturnValue('google-access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('google-refresh-token'),
}));

vi.mock('@shared/services/audit.js', () => ({
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
  const cookies: Record<string, string> = {};

  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [nameRaw, ...rest] = part.trim().split('=');
      if (!nameRaw) continue;
      cookies[nameRaw] = decodeURIComponent(rest.join('=') || '');
    }
  }

  (req as any).cookies = cookies;
  next();
};

describe('Google OAuth flow e2e harness', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(testCookieParser);
    app.use(googleRouter);
    app.use(googleStartRouter);
    app.use(errorHandler);

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
