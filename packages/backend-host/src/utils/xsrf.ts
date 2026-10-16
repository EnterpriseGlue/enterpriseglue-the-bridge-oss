import type { Request, Response } from 'express';
import { config, shouldUseSecureCookies } from '@enterpriseglue/shared/config/index.js';
import { XSRF_COOKIE_NAME, XSRF_HEADER_NAME } from '@enterpriseglue/shared/utils/xsrf.js';

/** Bind the new token to the session being issued, rather than the incoming session cookie. */
export function rotateXsrfToken(req: Request, res: Response, sessionIdentifier: string): void {
  res.locals.xsrfSessionIdentifier = sessionIdentifier;
  const token = req.csrfToken?.({ overwrite: true });
  if (token) res.setHeader(XSRF_HEADER_NAME, token);
}

export function clearXsrfToken(res: Response): void {
  res.clearCookie(XSRF_COOKIE_NAME, {
    domain: config.xsrfCookieDomain,
    path: '/',
    httpOnly: false,
    secure: shouldUseSecureCookies(),
    sameSite: 'lax',
  });
}
