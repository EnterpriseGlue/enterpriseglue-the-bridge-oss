import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import microsoftRouter from '../../../../../packages/backend-host/src/modules/auth/routes/microsoft.js';
import microsoftStartRouter from '../../../../../packages/backend-host/src/modules/auth/routes/microsoft-start.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import {
  isMicrosoftAuthEnabled,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  extractUserInfo,
  provisionMicrosoftUser,
} from '@enterpriseglue/shared/services/microsoft.js';

vi.mock('@enterpriseglue/shared/services/microsoft.js', () => ({
  isMicrosoftAuthEnabled: vi.fn().mockReturnValue(true),
  getAuthorizationUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  extractUserInfo: vi.fn(),
  provisionMicrosoftUser: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  generateAccessToken: vi.fn().mockReturnValue('microsoft-access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('microsoft-refresh-token'),
}));

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

describe('Microsoft OAuth flow e2e harness', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(testCookieParser);
    app.use(microsoftRouter);
    app.use(microsoftStartRouter);
    app.use(errorHandler);

    vi.clearAllMocks();

    (isMicrosoftAuthEnabled as unknown as Mock).mockReturnValue(true);
    (getAuthorizationUrl as unknown as Mock).mockImplementation(async (state: string) => (
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${encodeURIComponent(state)}`
    ));
    (exchangeCodeForTokens as unknown as Mock).mockResolvedValue({
      idTokenClaims: {
        oid: 'oid-123',
        email: 'entra-user@example.com',
        name: 'Entra User',
      },
    });
    (extractUserInfo as unknown as Mock).mockReturnValue({
      oid: 'oid-123',
      email: 'entra-user@example.com',
      name: 'Entra User',
    });
    (provisionMicrosoftUser as unknown as Mock).mockResolvedValue({
      id: 'user-1',
      email: 'entra-user@example.com',
      platformRole: 'admin',
      isActive: true,
    });
  });

  it('completes microsoft start -> callback flow and sets auth cookies', async () => {
    const agent = request.agent(app);

    const initResponse = await agent.get('/api/auth/microsoft');
    expect(initResponse.status).toBe(302);
    expect(initResponse.headers.location).toBe('/api/auth/microsoft/start');

    const startResponse = await agent.get('/api/auth/microsoft/start');
    expect(startResponse.status).toBe(302);
    expect(startResponse.headers.location).toContain('https://login.microsoftonline.com');

    const state = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');
    expect(state).toBeTruthy();
    expect(getAuthorizationUrl as unknown as Mock).toHaveBeenCalledWith(state);

    const callbackResponse = await agent
      .get('/api/auth/microsoft/callback')
      .query({ code: 'auth-code', state });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toBe(`${config.frontendUrl}/`);

    const setCookies = getSetCookieHeader(callbackResponse.headers);
    expect(setCookies?.some((cookie) => cookie.startsWith('accessToken='))).toBe(true);
    expect(setCookies?.some((cookie) => cookie.startsWith('refreshToken='))).toBe(true);
    expect(setCookies?.some((cookie) => cookie.startsWith('oauth_state='))).toBe(true);

    expect(exchangeCodeForTokens as unknown as Mock).toHaveBeenCalledWith('auth-code');
    expect(provisionMicrosoftUser as unknown as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'entra-user@example.com', oid: 'oid-123' })
    );
  });

  it('rejects callback when state does not match cookie', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/microsoft/start');

    const callbackResponse = await agent
      .get('/api/auth/microsoft/callback')
      .query({ code: 'auth-code', state: 'tampered-state' });

    expect(callbackResponse.status).toBe(400);
    expect(callbackResponse.body).toEqual({ error: 'Invalid state parameter' });
    expect(exchangeCodeForTokens as unknown as Mock).not.toHaveBeenCalled();
  });

  it('redirects to login error when provisioned user is deactivated', async () => {
    const agent = request.agent(app);

    const startResponse = await agent.get('/api/auth/microsoft/start');
    const state = getCookieValue(getSetCookieHeader(startResponse.headers), 'oauth_state');

    (provisionMicrosoftUser as unknown as Mock).mockResolvedValueOnce({
      id: 'user-1',
      email: 'entra-user@example.com',
      platformRole: 'admin',
      isActive: false,
    });

    const callbackResponse = await agent
      .get('/api/auth/microsoft/callback')
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
