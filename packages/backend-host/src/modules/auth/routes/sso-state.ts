import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '@enterpriseglue/shared/config/index.js';
import { signOidcState, signSamlRelayState, verifyOidcState, verifySamlRelayState } from '@enterpriseglue/shared/utils/samlRelayState.js';
import type { InvitationEnrollmentContext } from '@enterpriseglue/shared/services/invitations.js';

export interface SsoState {
  timestamp: number;
  nonce: string;
  providerId?: string;
  identityProviderKey?: string;
  identityProviderTenantId?: string;
  tenantSlug?: string;
  returnTo?: string;
  samlRequestId?: string;
  enrollment?: InvitationEnrollmentContext;
}

const TENANT_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9._-]{1,160}$/;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const STATE_FUTURE_SKEW_MS = 60 * 1000;
const SAML_REQUEST_ID_PATTERN = /^_[A-Za-z0-9_-]{32,160}$/;

/** Server-derived invitation references only; never raw bearer credentials. */
export function parseInvitationEnrollmentContext(value: unknown): InvitationEnrollmentContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const context = value as Record<string, unknown>;
  const keys = ['invitationId', 'userId', 'tenantId', 'tenantSlug', 'authSessionVersion'];
  if (Object.keys(context).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(context, key))) return null;
  if (!['invitationId', 'userId', 'tenantId'].every((key) => typeof context[key] === 'string' && PROVIDER_ID_PATTERN.test(context[key] as string))
    || typeof context.tenantSlug !== 'string' || !TENANT_SLUG_PATTERN.test(context.tenantSlug)
    || context.tenantSlug.length > 63 || context.authSessionVersion !== 0) return null;
  return { invitationId: context.invitationId as string, userId: context.userId as string,
    tenantId: context.tenantId as string, tenantSlug: context.tenantSlug, authSessionVersion: 0 };
}

function sanitizeTenantSlug(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !TENANT_SLUG_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizeProviderId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return PROVIDER_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function sanitizeReturnTo(value: unknown, tenantSlug?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return undefined;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined;

  try {
    const parsed = new URL(trimmed, 'http://enterpriseglue.local');
    if (parsed.origin !== 'http://enterpriseglue.local') return undefined;
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const tenantPrefix = `/t/${encodeURIComponent(tenantSlug || '')}`;
    if (tenantSlug && path !== tenantPrefix && !path.startsWith(`${tenantPrefix}/`)) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

export function createSamlRequestId(): string {
  return `_${randomBytes(32).toString('base64url')}`;
}

export function buildSsoState(req: Request, providerId?: string, identityProvider?: { key: string; tenantId?: string | null }, samlRequestId?: string, enrollment?: InvitationEnrollmentContext): string {
  const verifiedEnrollment = enrollment === undefined ? undefined : parseInvitationEnrollmentContext(enrollment);
  if (enrollment !== undefined && (!verifiedEnrollment || verifiedEnrollment.tenantId !== identityProvider?.tenantId
    || !sanitizeProviderId(providerId) || !sanitizeProviderId(identityProvider?.key))) {
    throw new Error('Invalid invitation enrollment state');
  }
  const tenantSlug = verifiedEnrollment?.tenantSlug || sanitizeTenantSlug(req.params?.tenantSlug)
    || sanitizeTenantSlug(req.query.tenantSlug)
    || sanitizeTenantSlug(req.tenant?.tenantSlug);
  const returnTo = sanitizeReturnTo(req.query.returnTo, tenantSlug);
  const payload: SsoState = {
    timestamp: Date.now(),
    nonce: randomBytes(32).toString('base64url'),
    ...(sanitizeProviderId(providerId) ? { providerId: sanitizeProviderId(providerId) } : {}),
    ...(sanitizeProviderId(identityProvider?.key) ? { identityProviderKey: sanitizeProviderId(identityProvider?.key) } : {}),
    ...(sanitizeProviderId(identityProvider?.tenantId) ? { identityProviderTenantId: sanitizeProviderId(identityProvider?.tenantId) } : {}),
    ...(tenantSlug ? { tenantSlug } : {}),
    ...(returnTo ? { returnTo } : {}),
    ...(samlRequestId && SAML_REQUEST_ID_PATTERN.test(samlRequestId) ? { samlRequestId } : {}),
    ...(verifiedEnrollment ? { enrollment: verifiedEnrollment } : {}),
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * SAML POST callbacks are cross-site and therefore cannot rely on a Lax
 * cookie. The signed RelayState keeps provider/tenant/return-path binding
 * intact without relaxing the session cookie policy.
 */
export function buildSignedSamlState(req: Request, providerId: string, identityProvider: { key: string; tenantId?: string | null }, samlRequestId: string, enrollment?: InvitationEnrollmentContext): string {
  const state = buildSsoState(req, providerId, identityProvider, samlRequestId, enrollment);
  return signSamlRelayState(state);
}

export function buildSignedOidcState(req: Request, providerId: string, identityProvider: { key: string; tenantId?: string | null }, enrollment?: InvitationEnrollmentContext): string {
  return signOidcState(buildSsoState(req, providerId, identityProvider, undefined, enrollment));
}

export function parseSsoState(rawState: unknown): SsoState | null {
  if (typeof rawState !== 'string' || !rawState) return null;

  try {
    const decoded = Buffer.from(rawState, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as Partial<SsoState>;
    if (typeof parsed.timestamp !== 'number' || typeof parsed.nonce !== 'string') return null;
    const age = Date.now() - parsed.timestamp;
    if (age > STATE_MAX_AGE_MS || age < -STATE_FUTURE_SKEW_MS) return null;

    const tenantSlug = sanitizeTenantSlug(parsed.tenantSlug);
    const providerId = sanitizeProviderId(parsed.providerId);
    const identityProviderKey = sanitizeProviderId(parsed.identityProviderKey);
    const identityProviderTenantId = sanitizeProviderId(parsed.identityProviderTenantId);
    const returnTo = sanitizeReturnTo(parsed.returnTo, tenantSlug);
    const samlRequestId = typeof parsed.samlRequestId === 'string' && SAML_REQUEST_ID_PATTERN.test(parsed.samlRequestId) ? parsed.samlRequestId : undefined;
    const hasEnrollment = Object.prototype.hasOwnProperty.call(parsed, 'enrollment');
    const enrollment = hasEnrollment ? parseInvitationEnrollmentContext(parsed.enrollment) : undefined;
    if (hasEnrollment && (!enrollment || !providerId || !identityProviderKey
      || enrollment.tenantId !== identityProviderTenantId || enrollment.tenantSlug !== tenantSlug)) return null;
    return {
      timestamp: parsed.timestamp,
      nonce: parsed.nonce,
      ...(providerId ? { providerId } : {}),
      ...(identityProviderKey ? { identityProviderKey } : {}),
      ...(identityProviderTenantId ? { identityProviderTenantId } : {}),
      ...(tenantSlug ? { tenantSlug } : {}),
      ...(returnTo ? { returnTo } : {}),
      ...(samlRequestId ? { samlRequestId } : {}),
      ...(enrollment ? { enrollment } : {}),
    };
  } catch {
    return null;
  }
}

export function parseSignedSamlState(rawState: unknown): SsoState | null {
  return parseSsoState(verifySamlRelayState(rawState));
}

export function parseSignedOidcState(rawState: unknown): SsoState | null {
  return parseSsoState(verifyOidcState(rawState));
}

export function getSsoReturnPath(state: SsoState | null): string {
  if (state?.returnTo) return state.returnTo;
  if (state?.tenantSlug) return `/t/${encodeURIComponent(state.tenantSlug)}/`;
  return '/';
}

export function getSsoRedirectUrl(state: SsoState | null): string {
  const baseUrl = config.frontendUrl.replace(/\/$/, '');
  return `${baseUrl}${getSsoReturnPath(state)}`;
}
