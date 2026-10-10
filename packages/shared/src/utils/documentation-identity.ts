import { DocumentationExchangeRequestSchema } from '../schemas/auth/documentation.js';
export { DocumentationGrantRequestSchema, DocumentationExchangeRequestSchema } from '../schemas/auth/documentation.js';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/index.js';
import { Errors } from '../middleware/errorHandler.js';
import { normalizeUserJwtPayload, type UserJwtPayload } from './jwt.js';

const sourceSchema = z.object({
  principalType: z.literal('user'), principalId: z.string().min(1).max(255),
  userId: z.string().min(1).max(255), type: z.literal('access'),
  sessionId: z.uuid(), authSessionVersion: z.number().int().nonnegative(),
  authenticationMethod: z.enum(['local', 'oidc', 'saml', 'ldap', 'passkey']),
  mfaVerified: z.boolean().optional(), sessionClass: z.literal('cloud_account').optional(),
  tenantId: z.string().min(1).max(255).optional(), tenantSlug: z.string().min(1).max(63).optional(),
}).strict();
const claimsSchema = z.object({
  type: z.enum(['documentation_grant', 'documentation_session']),
  permission: z.literal('documentation:read'), source: sourceSchema,
  jti: z.uuid(), iss: z.string(), aud: z.string(), iat: z.number().int(), exp: z.number().int(),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
}).strict();
export type DocumentationIdentity = z.infer<typeof claimsSchema>;

export function documentationConfiguration() {
  if (!config.documentationOrigin || !config.documentationGatewaySecret
    || config.tenancyMode !== 'pooled' || !config.tenancyCloudRequired || !config.cloudAccountIdentityEnabled) {
    throw Errors.notFound('Documentation access');
  }
  const origin = new URL(config.documentationOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || config.documentationGatewaySecret === config.jwtSecret) {
    throw Errors.serviceUnavailable('Documentation configuration');
  }
  return { origin: origin.origin, issuer: new URL(config.frontendUrl).origin, secret: config.documentationGatewaySecret };
}

function signingKey(type: DocumentationIdentity['type']): Buffer {
  return createHmac('sha256', documentationConfiguration().secret).update(`enterpriseglue:${type}:v1`).digest();
}

export function requireDocumentationGatewaySecret(value: unknown): void {
  const expected = Buffer.from(documentationConfiguration().secret);
  const actual = typeof value === 'string' && value.length <= 512 ? Buffer.from(value) : Buffer.alloc(0);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Errors.unauthorized('Documentation gateway required');
}

export function documentationSource(principal: UserJwtPayload): z.infer<typeof sourceSchema> {
  if (principal.recovery) throw Errors.forbidden('Recovery sessions cannot access documentation');
  return sourceSchema.parse({
    principalType: principal.principalType, principalId: principal.principalId, userId: principal.userId,
    type: 'access', sessionId: principal.sessionId, authSessionVersion: principal.authSessionVersion ?? 0,
    authenticationMethod: principal.authenticationMethod,
    ...(principal.mfaVerified === true ? { mfaVerified: true } : {}),
    ...(principal.sessionClass ? { sessionClass: principal.sessionClass } : {}),
    ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
    ...(principal.tenantSlug ? { tenantSlug: principal.tenantSlug } : {}),
  });
}

export function signDocumentationIdentity(type: DocumentationIdentity['type'], source: DocumentationIdentity['source'], seconds: number, challenge?: string): string {
  const { issuer, origin } = documentationConfiguration();
  return jwt.sign({ type, permission: 'documentation:read', source: sourceSchema.parse(source), ...(challenge ? { challenge } : {}) }, signingKey(type), {
    algorithm: 'HS256', issuer, audience: origin, jwtid: randomUUID(), expiresIn: Math.min(seconds, type === 'documentation_grant' ? 60 : 900),
  });
}

export function verifyDocumentationIdentity(value: unknown, type: DocumentationIdentity['type']): DocumentationIdentity {
  try {
    if (typeof value !== 'string' || value.length > 4096) throw new Error();
    const { issuer, origin } = documentationConfiguration();
    const claims = claimsSchema.parse(jwt.verify(value, signingKey(type), { algorithms: ['HS256'], issuer, audience: origin }));
    if (claims.type !== type || claims.iat < 0 || claims.iat > Math.floor(Date.now() / 1000) + 5 || claims.exp <= claims.iat || claims.exp - claims.iat > (type === 'documentation_grant' ? 60 : 900)
      || (type === 'documentation_grant' ? !claims.challenge : claims.challenge !== undefined)) throw new Error();
    normalizeUserJwtPayload(claims.source);
    return claims;
  } catch { throw Errors.unauthorized('Documentation session is invalid or expired'); }
}

export function verifyDocumentationGrant(code: unknown, verifier: unknown): DocumentationIdentity {
  const parsed = DocumentationExchangeRequestSchema.parse({ code, verifier });
  const claims = verifyDocumentationIdentity(parsed.code, 'documentation_grant');
  const challenge = createHash('sha256').update(parsed.verifier).digest('base64url');
  if (challenge !== claims.challenge) throw Errors.unauthorized('Documentation browser proof does not match');
  return claims;
}
