import type express from 'express';
import { doubleCsrf } from 'csrf-csrf';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { XSRF_COOKIE_NAME, XSRF_HEADER_NAME } from '@enterpriseglue/shared/utils/xsrf.js';

export function installBrowserRequestProtection(app: express.Express): void {
  app.use((req, res, next) => {
    const cookieHeader = req.headers.cookie;
    const cookies = new Map<string, string>();
    let duplicateXsrfCookie = false;

    if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
      for (const part of cookieHeader.split(';')) {
        const [nameRaw, ...rest] = part.trim().split('=');
        if (!nameRaw || nameRaw === '__proto__' || nameRaw === 'constructor' || nameRaw === 'prototype') continue;

        if (nameRaw === XSRF_COOKIE_NAME && cookies.has(nameRaw)) duplicateXsrfCookie = true;
        const valueRaw = rest.join('=') || '';
        try {
          cookies.set(nameRaw, decodeURIComponent(valueRaw));
        } catch {
          cookies.set(nameRaw, valueRaw);
        }
      }
    }

    req.cookies = Object.setPrototypeOf(Object.fromEntries(cookies), null);
    res.locals.duplicateXsrfCookie = duplicateXsrfCookie;
    next();
  });

  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => config.jwtSecret,
    getSessionIdentifier: (req) => req.res?.locals.xsrfSessionIdentifier ?? req.cookies?.refreshToken ?? req.cookies?.accessToken ?? req.ip ?? '',
    cookieName: XSRF_COOKIE_NAME,
    cookieOptions: {
      httpOnly: false, // Only this signed token cookie is readable by the frontend.
      domain: config.xsrfCookieDomain,
      secure: shouldUseSecureCookies(),
      sameSite: 'lax',
      path: '/',
    },
    getCsrfTokenFromRequest: (req: any) => req.res?.locals.duplicateXsrfCookie ? undefined : req.headers[XSRF_HEADER_NAME.toLowerCase()],
    skipCsrfProtection: (req) => {
      // Skip CSRF for login/refresh and CSRF token fetch (these endpoints validate credentials directly)
      if (req.path === '/api/auth/login' || req.path === '/api/auth/refresh' || req.path === '/api/csrf-token') return true;
      if (req.method === 'POST' && /^\/api\/(?:t\/[^/]+\/)?auth\/identity\/callback$/.test(req.path)) return true;
      // Email completion consumes a browser proof cookie before an access cookie exists.
      if (/^\/api\/auth\/cloud-signup\/email\/complete\/?$/i.test(req.path)) return false;

      const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
      const hasBearer = authHeader.startsWith('Bearer ');
      const hasCookieAccessToken = Boolean((req as any).cookies?.accessToken);

      // CSRF is relevant for cookie-authenticated requests; Bearer-token APIs are not vulnerable.
      if (hasBearer || !hasCookieAccessToken) return true;

      return false;
    },
  });

  // Global CSRF protection for cookie-authenticated routes.
  // skipCsrfProtection above will bypass this for safe/Bearer-only endpoints.
  app.use(doubleCsrfProtection);

  // Endpoint for the frontend to obtain a CSRF token.
  // This also bootstraps the readable XSRF-TOKEN cookie.
  app.get('/api/csrf-token', (req, res) => {
    const csrfToken = generateCsrfToken(req, res);
    res.setHeader(XSRF_HEADER_NAME, csrfToken);
    res.json({ csrfToken });
  });

  // CSRF error handler — doubleCsrfProtection calls next(err) on invalid tokens.
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf'))) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next(err);
  });

  // Bootstrap/renew the readable cookie on safe requests. Auth routes rotate it after setting session cookies.
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    try {
      const token = generateCsrfToken(req as any, res as any);
      res.setHeader(XSRF_HEADER_NAME, token);
    } catch {
      // ignore — token generation may fail for skipped requests
    }
    next();
  });
}
