import jwt from 'jsonwebtoken';
import { config } from '@enterpriseglue/shared/config/index.js';

const AUDIENCE = 'identity-saml-state';
const ISSUER = 'enterpriseglue';

/** Signs only the opaque, already-sanitized SSO state payload. */
export function signSamlRelayState(state: string): string {
  return jwt.sign({ state }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '10m',
    audience: AUDIENCE,
    issuer: ISSUER,
  });
}

export function verifySamlRelayState(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const payload = jwt.verify(value, config.jwtSecret, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    const state = typeof payload === 'object' && payload ? (payload as { state?: unknown }).state : null;
    return typeof state === 'string' ? state : null;
  } catch {
    return null;
  }
}
