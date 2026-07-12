import type { Request } from 'express';
import { config } from '@enterpriseglue/shared/config/index.js';

export type SsoProviderType = 'microsoft' | 'saml' | 'oidc' | 'ldap';

export interface SsoState {
  timestamp: number;
  nonce: string;
  providerId?: string;
  identityProviderKey?: string;
  identityProviderTenantId?: string;
  tenantSlug?: string;
  returnTo?: string;
}

export interface SsoProvisionedContext {
  provider: SsoProviderType;
  providerId?: string;
  tenantSlug: string | null;
  returnTo: string;
  user: any;
  userInfo: any;
}

const TENANT_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9._-]{1,160}$/;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

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

export function buildSsoState(req: Request, providerId?: string, identityProvider?: { key: string; tenantId?: string | null }): string {
  const tenantSlug = sanitizeTenantSlug(req.query.tenantSlug);
  const returnTo = sanitizeReturnTo(req.query.returnTo, tenantSlug);
  const payload: SsoState = {
    timestamp: Date.now(),
    nonce: Math.random().toString(36).substring(7),
    ...(sanitizeProviderId(providerId) ? { providerId: sanitizeProviderId(providerId) } : {}),
    ...(sanitizeProviderId(identityProvider?.key) ? { identityProviderKey: sanitizeProviderId(identityProvider?.key) } : {}),
    ...(sanitizeProviderId(identityProvider?.tenantId) ? { identityProviderTenantId: sanitizeProviderId(identityProvider?.tenantId) } : {}),
    ...(tenantSlug ? { tenantSlug } : {}),
    ...(returnTo ? { returnTo } : {}),
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function appendSsoStartQuery(req: Request, startPath: string): string {
  const params = new URLSearchParams();
  const tenantSlug = sanitizeTenantSlug(req.query.tenantSlug);
  const returnTo = sanitizeReturnTo(req.query.returnTo, tenantSlug);
  const providerId = sanitizeProviderId(req.query.providerId);

  if (tenantSlug) params.set('tenantSlug', tenantSlug);
  if (returnTo) params.set('returnTo', returnTo);
  if (providerId) params.set('providerId', providerId);

  const query = params.toString();
  return query ? `${startPath}?${query}` : startPath;
}

export function parseSsoState(rawState: unknown): SsoState | null {
  if (typeof rawState !== 'string' || !rawState) return null;

  try {
    const decoded = Buffer.from(rawState, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as Partial<SsoState>;
    if (typeof parsed.timestamp !== 'number' || typeof parsed.nonce !== 'string') return null;
    if (Date.now() - parsed.timestamp > STATE_MAX_AGE_MS) return null;

    const tenantSlug = sanitizeTenantSlug(parsed.tenantSlug);
    const providerId = sanitizeProviderId(parsed.providerId);
    const identityProviderKey = sanitizeProviderId(parsed.identityProviderKey);
    const identityProviderTenantId = sanitizeProviderId(parsed.identityProviderTenantId);
    const returnTo = sanitizeReturnTo(parsed.returnTo, tenantSlug);
    return {
      timestamp: parsed.timestamp,
      nonce: parsed.nonce,
      ...(providerId ? { providerId } : {}),
      ...(identityProviderKey ? { identityProviderKey } : {}),
      ...(identityProviderTenantId ? { identityProviderTenantId } : {}),
      ...(tenantSlug ? { tenantSlug } : {}),
      ...(returnTo ? { returnTo } : {}),
    };
  } catch {
    return null;
  }
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

export async function notifySsoUserProvisioned(
  req: Request,
  context: SsoProvisionedContext
): Promise<void> {
  const hook = req.app.locals?.onSsoUserProvisioned;
  if (typeof hook === 'function') {
    await hook(context);
  }
}
