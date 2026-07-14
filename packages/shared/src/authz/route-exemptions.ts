import type { AuthzActionRisk } from './permission-actions.js';

export const AUTHZ_OPENAPI_EXEMPTION_KEY = 'x-enterpriseglue-authz-exemption' as const;

export const AUTHZ_ROUTE_EXEMPTION_KINDS = ['auth-only', 'public'] as const;
export type AuthzRouteExemptionKind = typeof AUTHZ_ROUTE_EXEMPTION_KINDS[number];

export interface AuthzRouteExemption {
  method: string;
  route: string;
  kind: AuthzRouteExemptionKind;
  risk: AuthzActionRisk;
  owner: string;
  reason: string;
}

export interface AuthzOpenApiExemption {
  kind: AuthzRouteExemptionKind;
  reason: string;
  risk: AuthzActionRisk;
  owner: string;
}

function publicRoute(method: string, route: string, risk: AuthzActionRisk, owner: string, reason: string): AuthzRouteExemption {
  return { method, route, kind: 'public', risk, owner, reason };
}

function tokenAuthenticatedRoute(method: string, route: string, risk: AuthzActionRisk, reason: string): AuthzRouteExemption {
  return { method, route, kind: 'auth-only', risk, owner: 'platform-auth', reason };
}

export const AUTHZ_ROUTE_EXEMPTIONS: AuthzRouteExemption[] = [
  publicRoute('GET', '/health', 'low', 'platform-runtime', 'Unauthenticated health probes expose only a static service readiness status.'),
  publicRoute('GET', '/api/sso/providers/enabled', 'low', 'platform-auth', 'The login page needs the sanitized enabled-provider catalog before a user session exists.'),
  publicRoute('POST', '/api/auth/login', 'high', 'platform-auth', 'Credential login must be reachable before a session exists and is protected by authentication rate limits.'),
  tokenAuthenticatedRoute('POST', '/api/auth/complete-onboarding', 'high', 'A one-time onboarding token authorizes completion before the normal user session is issued.'),
  tokenAuthenticatedRoute('POST', '/api/auth/refresh', 'medium', 'The refresh cookie authenticates session renewal when the access token is unavailable or expired.'),
  publicRoute('POST', '/api/auth/forgot-password', 'medium', 'platform-auth', 'Password recovery initiation must be reachable before authentication and returns a non-enumerating response.'),
  publicRoute('POST', '/api/auth/reset-password-with-token', 'high', 'platform-auth', 'A single-use reset token authorizes password replacement before a session exists.'),
  publicRoute('GET', '/api/auth/verify-reset-token', 'low', 'platform-auth', 'The recovery UI may validate an opaque reset token without exposing account details.'),
  publicRoute('POST', '/api/auth/resend-verification', 'medium', 'platform-auth', 'Email verification delivery must be available before login and uses a non-enumerating response.'),
  publicRoute('GET', '/api/auth/verify-email', 'medium', 'platform-auth', 'An opaque verification token authorizes email verification before login.'),
  publicRoute('GET', '/api/auth/branding', 'low', 'platform-auth', 'The unauthenticated login screen needs non-secret platform branding.'),
  publicRoute('GET', '/api/auth/google/start', 'medium', 'platform-auth', 'Starts a state-bound Google login flow before a local session exists.'),
  publicRoute('GET', '/api/auth/google', 'medium', 'platform-auth', 'Starts the legacy state-bound Google login flow before a local session exists.'),
  publicRoute('GET', '/api/auth/google/callback', 'high', 'platform-auth', 'Completes a state-bound Google identity callback before issuing a local session.'),
  publicRoute('GET', '/api/auth/google/status', 'low', 'platform-auth', 'The login page reads only whether Google login is enabled.'),
  publicRoute('GET', '/api/auth/microsoft/start', 'medium', 'platform-auth', 'Starts a state-bound Microsoft login flow before a local session exists.'),
  publicRoute('GET', '/api/auth/microsoft', 'medium', 'platform-auth', 'Starts the legacy state-bound Microsoft login flow before a local session exists.'),
  publicRoute('GET', '/api/auth/microsoft/callback', 'high', 'platform-auth', 'Completes a state-bound Microsoft identity callback before issuing a local session.'),
  publicRoute('GET', '/api/auth/microsoft/status', 'low', 'platform-auth', 'The login page reads only whether Microsoft login is enabled.'),
  publicRoute('GET', '/api/auth/saml/start', 'medium', 'platform-auth', 'Starts a state-bound SAML login flow before a local session exists.'),
  publicRoute('GET', '/api/auth/saml', 'medium', 'platform-auth', 'Starts the legacy state-bound SAML login flow before a local session exists.'),
  publicRoute('POST', '/api/auth/saml/callback', 'high', 'platform-auth', 'Consumes a signed SAML assertion and state before issuing a local session.'),
  publicRoute('GET', '/api/auth/saml/metadata', 'low', 'platform-auth', 'Identity providers require public non-secret service-provider metadata.'),
  publicRoute('GET', '/api/auth/saml/status', 'low', 'platform-auth', 'The login page reads only whether SAML login is enabled.'),
  publicRoute('GET', '/api/auth/identity/:key/start', 'medium', 'platform-auth', 'Starts a state-bound provider-neutral OIDC login flow before a local session exists.'),
  publicRoute('GET', '/api/auth/identity/callback', 'high', 'platform-auth', 'Completes a state-bound provider-neutral OIDC callback before issuing a local session.'),
  publicRoute('POST', '/api/auth/identity/:key/ldap/login', 'high', 'platform-auth', 'Direct directory login validates credentials before issuing a local session and is rate limited.'),
  publicRoute('GET', '/api/auth/providers/enabled', 'low', 'platform-auth', 'The login page needs sanitized provider-neutral login options before authentication.'),
  publicRoute('GET', '/api/auth/providers/:providerId/start', 'medium', 'platform-auth', 'Starts a state-bound provider-neutral redirect login before a local session exists.'),
  publicRoute('POST', '/api/auth/providers/:providerId/login', 'high', 'platform-auth', 'Provider-neutral directory login validates credentials before issuing a local session and is rate limited.'),
  publicRoute('POST', '/api/auth/providers/saml/callback', 'high', 'platform-auth', 'Consumes a signed provider-neutral SAML assertion and state before issuing a local session.'),
  publicRoute('GET', '/api/t/:tenantSlug/auth/sso-config', 'low', 'platform-auth', 'Tenant login discovery exposes only sanitized SSO configuration before authentication.'),
  {
    method: 'POST',
    route: '/api/auth/logout',
    kind: 'auth-only',
    risk: 'low',
    owner: 'platform-auth',
    reason: 'Authenticated users must be able to terminate their own session without a business RBAC permission.',
  },
  {
    method: 'GET',
    route: '/api/auth/me',
    kind: 'auth-only',
    risk: 'low',
    owner: 'platform-auth',
    reason: 'Authenticated users must be able to read their own profile and current capability snapshot.',
  },
  {
    method: 'PATCH',
    route: '/api/auth/me',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'platform-auth',
    reason: 'Authenticated users may update safe self-profile fields; admin-controlled fields are not accepted here.',
  },
  {
    method: 'GET',
    route: '/api/auth/platform-settings',
    kind: 'auth-only',
    risk: 'low',
    owner: 'platform-auth',
    reason: 'Authenticated UI clients need non-secret platform settings before resource-specific authorization decisions.',
  },
  {
    method: 'POST',
    route: '/api/auth/reset-password',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'platform-auth',
    reason: 'Authenticated first-login password reset is a self-service account recovery step.',
  },
  {
    method: 'POST',
    route: '/api/auth/change-password',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'platform-auth',
    reason: 'Authenticated users may rotate their own password after current-password verification.',
  },
  {
    method: 'GET',
    route: '/engines-api/my-engines',
    kind: 'auth-only',
    risk: 'low',
    owner: 'engine-management',
    reason: 'Authenticated users may list only engines already visible to their own effective access.',
  },
  {
    method: 'GET',
    route: '/engines-api/environment-tags',
    kind: 'auth-only',
    risk: 'low',
    owner: 'engine-management',
    reason: 'Authenticated users may read the non-secret environment tag catalog used by engine views and forms.',
  },
  {
    method: 'GET',
    route: '/git-api/providers',
    kind: 'auth-only',
    risk: 'low',
    owner: 'git-integrations',
    reason: 'Authenticated users may read the non-secret active Git provider catalog used by project and credential flows.',
  },
  {
    method: 'GET',
    route: '/git-api/providers/:id',
    kind: 'auth-only',
    risk: 'low',
    owner: 'git-integrations',
    reason: 'Authenticated users may read non-secret details for an active Git provider used by project and credential flows.',
  },
  {
    method: 'GET',
    route: '/git-api/providers/:id/repos',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-integrations',
    reason: 'Authenticated users may list remote repositories only through their own Git credential for the selected provider.',
  },
  {
    method: 'POST',
    route: '/starbase-api/deployments',
    kind: 'auth-only',
    risk: 'low',
    owner: 'starbase-deployments',
    reason: 'This authenticated endpoint is an unimplemented multipart deployment stub that always returns 501 and performs no resource operation.',
  },
  {
    method: 'GET',
    route: '/starbase-api/projects/:projectId/members/me',
    kind: 'auth-only',
    risk: 'low',
    owner: 'starbase-members',
    reason: 'Authenticated users may read only their own project membership; the route returns not found when the caller is not a member.',
  },
  {
    method: 'GET',
    route: '/git-api/credentials',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may list only their own Git credentials.',
  },
  {
    method: 'GET',
    route: '/git-api/credentials/:providerId',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may read only their own Git credential metadata for a provider.',
  },
  {
    method: 'POST',
    route: '/git-api/credentials',
    kind: 'auth-only',
    risk: 'high',
    owner: 'git-credentials',
    reason: 'Authenticated users may save only their own Git credentials; token material is accepted only for caller-owned credential storage.',
  },
  {
    method: 'PATCH',
    route: '/git-api/credentials/:credentialId',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may rename only their own Git credentials.',
  },
  {
    method: 'DELETE',
    route: '/git-api/credentials/:providerId',
    kind: 'auth-only',
    risk: 'high',
    owner: 'git-credentials',
    reason: 'Authenticated users may delete only their own Git credentials for a provider.',
  },
  {
    method: 'GET',
    route: '/git-api/credentials/:providerId/validate',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may validate only their own Git credentials.',
  },
  {
    method: 'GET',
    route: '/git-api/credentials/:credentialId/namespaces',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may list remote namespaces only through their own Git credential.',
  },
  {
    method: 'GET',
    route: '/git-api/oauth/:providerId/config',
    kind: 'auth-only',
    risk: 'low',
    owner: 'git-credentials',
    reason: 'Authenticated users may read non-secret OAuth configuration needed to start their own Git credential flow.',
  },
  {
    method: 'GET',
    route: '/git-api/oauth/:providerId/authorize',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may start an OAuth flow only for their own Git credential.',
  },
  {
    method: 'GET',
    route: '/git-api/oauth/:providerId/authorize/redirect',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may start a server-side OAuth redirect only for their own Git credential.',
  },
  {
    method: 'GET',
    route: '/git-api/oauth/authorize/redirect',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may continue a pending server-side OAuth redirect bound to their own session.',
  },
  {
    method: 'POST',
    route: '/git-api/oauth/callback',
    kind: 'auth-only',
    risk: 'high',
    owner: 'git-credentials',
    reason: 'Authenticated users may complete an OAuth callback only when the OAuth state maps back to their own user id.',
  },
  {
    method: 'POST',
    route: '/git-api/oauth/:providerId/refresh',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'git-credentials',
    reason: 'Authenticated users may refresh only their own OAuth-backed Git credential.',
  },
  {
    method: 'GET',
    route: '/api/t/:tenantSlug/invitations/capabilities',
    kind: 'auth-only',
    risk: 'low',
    owner: 'invitations',
    reason: 'Authenticated users may read non-secret invitation readiness flags before resource-specific invite permission is evaluated.',
  },
  {
    method: 'GET',
    route: '/api/notifications',
    kind: 'auth-only',
    risk: 'low',
    owner: 'notifications',
    reason: 'Authenticated users may list only their own tenant-scoped notifications.',
  },
  {
    method: 'POST',
    route: '/api/notifications',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'notifications',
    reason: 'Authenticated users may create only their own tenant-scoped notifications; no cross-user target is accepted.',
  },
  {
    method: 'PATCH',
    route: '/api/notifications/read',
    kind: 'auth-only',
    risk: 'low',
    owner: 'notifications',
    reason: 'Authenticated users may mark only their own tenant-scoped notifications as read.',
  },
  {
    method: 'DELETE',
    route: '/api/notifications',
    kind: 'auth-only',
    risk: 'low',
    owner: 'notifications',
    reason: 'Authenticated users may delete only their own tenant-scoped notifications.',
  },
  {
    method: 'DELETE',
    route: '/api/notifications/:id',
    kind: 'auth-only',
    risk: 'low',
    owner: 'notifications',
    reason: 'Authenticated users may delete only a notification owned by their own user and tenant.',
  },
  {
    method: 'GET',
    route: '/stream',
    kind: 'auth-only',
    risk: 'low',
    owner: 'notifications',
    reason: 'Mounted notification stream route is authenticated and binds the SSE connection to the current user.',
  },
  {
    method: 'GET',
    route: '/api/notifications/stream',
    kind: 'auth-only',
    risk: 'low',
    owner: 'notifications',
    reason: 'Authenticated users may open a notification SSE stream bound to their own user and tenant.',
  },
  {
    method: 'POST',
    route: '/api/authz/check',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'access-control',
    reason: 'Authenticated users may evaluate only their own effective access for UI guard decisions.',
  },
  {
    method: 'POST',
    route: '/api/authz/check-batch',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'access-control',
    reason: 'Authenticated users may batch-evaluate only their own effective access for UI guard decisions.',
  },
  {
    method: 'GET',
    route: '/api/authz/me/permissions',
    kind: 'auth-only',
    risk: 'medium',
    owner: 'access-control',
    reason: 'Authenticated users need their own effective permission snapshot for frontend authorization UX; backend checks remain authoritative.',
  },
];

function normalizeExemptionRoutePath(route: string): string {
  const normalized = route
    .trim()
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function exemptionKey(method: string, route: string): string {
  return `${method.trim().toUpperCase()} ${normalizeExemptionRoutePath(route)}`;
}

export function listAuthzRouteExemptions(): AuthzRouteExemption[] {
  return [...AUTHZ_ROUTE_EXEMPTIONS];
}

export function getAuthzRouteExemption(method: string, route: string): AuthzRouteExemption | undefined {
  const key = exemptionKey(method, route);
  return AUTHZ_ROUTE_EXEMPTIONS.find((exemption) => exemptionKey(exemption.method, exemption.route) === key);
}

export function toOpenApiAuthzExemption(exemption: AuthzRouteExemption): AuthzOpenApiExemption {
  return {
    kind: exemption.kind,
    reason: exemption.reason,
    risk: exemption.risk,
    owner: exemption.owner,
  };
}
