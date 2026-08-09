import jwt from 'jsonwebtoken';
import { config } from '@enterpriseglue/shared/config/index.js';

const SAML_AUDIENCE = 'identity-saml-state';
const OIDC_AUDIENCE = 'identity-oidc-state';
const ISSUER = 'enterpriseglue';

function signState(state: string, audience: string): string {
  return jwt.sign({ state }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '10m',
    audience,
    issuer: ISSUER,
  });
}

function verifyState(value: unknown, audience: string): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const payload = jwt.verify(value, config.jwtSecret, {
      algorithms: ['HS256'],
      audience,
      issuer: ISSUER,
    });
    const state = typeof payload === 'object' && payload ? (payload as { state?: unknown }).state : null;
    return typeof state === 'string' ? state : null;
  } catch {
    return null;
  }
}

/** Signs only the opaque, already-sanitized SSO state payload. */
export function signSamlRelayState(state: string): string {
  return signState(state, SAML_AUDIENCE);
}

export function verifySamlRelayState(value: unknown): string | null {
  return verifyState(value, SAML_AUDIENCE);
}

/** OIDC uses a distinct audience so a SAML RelayState cannot cross protocols. */
export function signOidcState(state: string): string {
  return signState(state, OIDC_AUDIENCE);
}

export function verifyOidcState(value: unknown): string | null {
  return verifyState(value, OIDC_AUDIENCE);
}
