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
  publicRoute('GET', '/health', 'low', 'platform-runtime', 'Unauthenticated health probes expose only sanitized configuration bootstrap state.'),
  publicRoute('GET', '/ready', 'low', 'platform-runtime', 'Unauthenticated readiness probes expose only sanitized configuration bootstrap state.'),
  publicRoute('GET', '/metrics', 'low', 'platform-runtime', 'Unauthenticated metrics expose only bounded enum-backed configuration bootstrap, aggregate engine-tenancy, and login-experience gauges/counters without tenant, engine, provider, or principal identifiers.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/ServiceProviderConfig', 'medium', 'A directory-scoped provisioning bearer credential authorizes SCIM capability discovery without accepting a caller-selected tenant.'),
  tokenAuthenticatedRoute('POST', '/scim/v2/:directoryKey/oauth/token', 'high', 'A reveal-once directory client credential is exchanged for a short-lived, directory-scoped SCIM access token.'),
  tokenAuthenticatedRoute('POST', '/scim/v2/:directoryKey/Bulk', 'critical', 'A directory-scoped provisioning credential authorizes a bounded SCIM Bulk request; each operation retains normal tenant and lifecycle controls.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/Schemas', 'medium', 'A directory-scoped provisioning bearer credential authorizes SCIM schema discovery.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/Schemas/:schemaId', 'medium', 'A directory-scoped provisioning bearer credential authorizes SCIM schema discovery.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/ResourceTypes', 'medium', 'A directory-scoped provisioning bearer credential authorizes SCIM resource-type discovery.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/ResourceTypes/:resourceType', 'medium', 'A directory-scoped provisioning bearer credential authorizes SCIM resource-type discovery.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/Users', 'high', 'A directory-scoped provisioning bearer credential authorizes bounded reads of only that directory’s users.'),
  tokenAuthenticatedRoute('POST', '/scim/v2/:directoryKey/Users', 'high', 'A directory-scoped provisioning bearer credential authorizes transactional user provisioning only in its bound directory.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/Users/:id', 'high', 'A directory-scoped provisioning bearer credential authorizes one bound-directory user read.'),
  tokenAuthenticatedRoute('PUT', '/scim/v2/:directoryKey/Users/:id', 'high', 'A directory-scoped provisioning bearer credential authorizes version-guarded bound-directory user replacement.'),
  tokenAuthenticatedRoute('PATCH', '/scim/v2/:directoryKey/Users/:id', 'high', 'A directory-scoped provisioning bearer credential authorizes atomic version-guarded bound-directory user patching.'),
  tokenAuthenticatedRoute('DELETE', '/scim/v2/:directoryKey/Users/:id', 'critical', 'A directory-scoped provisioning bearer credential authorizes soft deprovisioning with immediate session invalidation.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/Groups', 'high', 'A directory-scoped provisioning bearer credential authorizes bounded reads of only that directory’s groups.'),
  tokenAuthenticatedRoute('POST', '/scim/v2/:directoryKey/Groups', 'high', 'A directory-scoped provisioning bearer credential authorizes transactional group provisioning only in its bound directory.'),
  tokenAuthenticatedRoute('GET', '/scim/v2/:directoryKey/Groups/:id', 'high', 'A directory-scoped provisioning bearer credential authorizes one bound-directory group read.'),
  tokenAuthenticatedRoute('PUT', '/scim/v2/:directoryKey/Groups/:id', 'high', 'A directory-scoped provisioning bearer credential authorizes version-guarded bound-directory group replacement.'),
  tokenAuthenticatedRoute('PATCH', '/scim/v2/:directoryKey/Groups/:id', 'high', 'A directory-scoped provisioning bearer credential authorizes atomic version-guarded membership patching.'),
  tokenAuthenticatedRoute('DELETE', '/scim/v2/:directoryKey/Groups/:id', 'high', 'A directory-scoped provisioning bearer credential authorizes archival of a directory group without deleting internal users or groups.'),
  publicRoute('POST', '/api/auth/login', 'high', 'platform-auth', 'Credential login must be reachable before a session exists and is protected by authentication rate limits.'),
  publicRoute('POST', '/api/auth/recovery/login', 'high', 'platform-auth', 'Dedicated administrator recovery verifies local credentials and current canonical platform-administrator membership under authentication rate limits.'),
  tokenAuthenticatedRoute('POST', '/api/auth/complete-onboarding', 'high', 'A one-time onboarding token authorizes completion before the normal user session is issued.'),
  tokenAuthenticatedRoute('POST', '/api/auth/refresh', 'medium', 'The refresh cookie authenticates session renewal when the access token is unavailable or expired.'),
  publicRoute('GET', '/api/tenancy/capabilities', 'low', 'native-tenancy', 'Returns only non-enumerating deployment tenancy capabilities required before route construction.'),
  publicRoute('POST', '/api/auth/tenant-discovery', 'medium', 'native-tenancy', 'Rate-limited work-email discovery returns one verified canonical tenant route or the same zero/multiple-match fallback without disclosing account existence.'),
  publicRoute('POST', '/api/auth/tenant-discovery/exchange', 'high', 'native-tenancy', 'A short-lived single-use email token may list only the linked user\'s active memberships and never creates an authenticated session.'),
  tokenAuthenticatedRoute('GET', '/api/auth/my-tenants', 'medium', 'Lists only active tenant memberships belonging to the authenticated principal.'),
  tokenAuthenticatedRoute('POST', '/api/auth/switch-tenant', 'high', 'Exchanges the authenticated session only after rechecking the caller\'s active target-tenant membership.'),
  {
    method: 'GET', route: '/api/t/:tenantSlug/tenant/cloud-identity', kind: 'auth-only', risk: 'high', owner: 'native-tenancy',
    reason: 'The native session, resolved placement v3 assertion, and active tenant membership are revalidated before a short-lived release-bound identity is minted.',
  },
  {
    method: 'PUT', route: '/api/workloads/tenants/:tenantId/release-assignment', kind: 'auth-only', risk: 'critical', owner: 'native-tenancy',
    reason: 'A private release-controller bearer credential may move only queued plugin work to the release and monotonically increasing assignment epoch configured on the target host.',
  },
  publicRoute('POST', '/api/auth/forgot-password', 'medium', 'platform-auth', 'Password recovery initiation must be reachable before authentication and returns a non-enumerating response.'),
  publicRoute('POST', '/api/auth/reset-password-with-token', 'high', 'platform-auth', 'A single-use reset token authorizes password replacement before a session exists.'),
  publicRoute('GET', '/api/auth/verify-reset-token', 'low', 'platform-auth', 'The recovery UI may validate an opaque reset token without exposing account details.'),
  publicRoute('POST', '/api/auth/resend-verification', 'medium', 'platform-auth', 'Email verification delivery must be available before login and uses a non-enumerating response.'),
  publicRoute('GET', '/api/auth/verify-email', 'medium', 'platform-auth', 'An opaque verification token authorizes email verification before login.'),
  publicRoute('GET', '/api/auth/branding', 'low', 'platform-auth', 'The unauthenticated login screen needs non-secret platform branding.'),
  publicRoute('GET', '/api/auth/identity/:key/start', 'medium', 'platform-auth', 'Starts a state-bound provider-neutral OIDC login flow before a local session exists.'),
  publicRoute('GET', '/api/auth/identity/callback', 'high', 'platform-auth', 'Completes a state-bound provider-neutral OIDC callback before issuing a local session.'),
  publicRoute('POST', '/api/auth/identity/:key/ldap/login', 'high', 'platform-auth', 'Direct directory login validates credentials before issuing a local session and is rate limited.'),
  publicRoute('GET', '/api/auth/providers/enabled', 'low', 'platform-auth', 'The login page needs sanitized provider-neutral login options before authentication.'),
  publicRoute('GET', '/api/auth/login-methods', 'low', 'platform-auth', 'The login page needs a sanitized policy-resolved list of available login methods before authentication.'),
  publicRoute('GET', '/api/auth/providers/:providerId/start', 'medium', 'platform-auth', 'Starts a state-bound provider-neutral redirect login before a local session exists.'),
  publicRoute('POST', '/api/auth/providers/:providerId/login', 'high', 'platform-auth', 'Provider-neutral directory login validates credentials before issuing a local session and is rate limited.'),
  publicRoute('GET', '/api/t/:tenantSlug/auth/login-methods', 'low', 'platform-auth', 'The tenant login page needs its sanitized, policy-resolved login methods before authentication.'),
  publicRoute('GET', '/api/t/:tenantSlug/auth/providers/:providerId/start', 'medium', 'platform-auth', 'Starts a state-bound provider-neutral redirect login in the resolved tenant scope.'),
  publicRoute('POST', '/api/t/:tenantSlug/auth/providers/:providerId/login', 'high', 'platform-auth', 'Tenant-scoped directory login validates credentials before issuing a session and is rate limited.'),
  publicRoute('GET', '/api/t/:tenantSlug/auth/identity/callback', 'high', 'platform-auth', 'Consumes a signed OIDC state only after release-aware tenant routing resolves the callback to the tenant assignment.'),
  publicRoute('POST', '/api/t/:tenantSlug/auth/providers/saml/callback', 'high', 'platform-auth', 'Consumes a signed SAML assertion and RelayState only after release-aware tenant routing resolves the callback to the tenant assignment.'),
  publicRoute('POST', '/api/auth/providers/saml/callback', 'high', 'platform-auth', 'Consumes a signed provider-neutral SAML assertion and state before issuing a local session.'),
  tokenAuthenticatedRoute('POST', '/api/auth/providers/:providerId/oidc/backchannel-logout', 'critical', 'A verified OIDC logout_token revokes only sessions bound to its configured provider subject or session identifier.'),
  publicRoute('POST', '/api/auth/identity/:providerKey/saml/logout', 'critical', 'platform-auth', 'Consumes only XML-signed SAML LogoutRequest or correlated signed LogoutResponse messages from the configured provider.'),
  publicRoute('GET', '/api/auth/identity/:providerKey/saml/logout', 'critical', 'platform-auth', 'Consumes only signed and correlated SAML HTTP-Redirect LogoutResponse messages from the configured provider.'),
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
    method: 'GET',
    route: '/t/:tenantSlug/api/plugins/v1/frontend',
    kind: 'auth-only',
    risk: 'low',
    owner: 'plugin-platform',
    reason: 'Authenticated tenant UI clients may load only the signed, tenant-enabled frontend contribution bootstrap. It contains no customer artifacts or authorization grant; every contextual action and plugin operation remains independently FGA-enforced.',
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
    route: '/api/invitations/:token',
    kind: 'public',
    risk: 'medium',
    owner: 'invitations',
    reason: 'An opaque, single-use invitation token authorizes the minimal invitation status needed before a user session exists.',
  },
  {
    method: 'POST',
    route: '/api/invitations/:token/verify-otp',
    kind: 'public',
    risk: 'high',
    owner: 'invitations',
    reason: 'An opaque invitation token plus a rate-limited one-time password authorizes onboarding state establishment before a user session exists.',
  },
  {
    method: 'POST',
    route: '/api/invitations/:token/redeem',
    kind: 'public',
    risk: 'high',
    owner: 'invitations',
    reason: 'An opaque single-use email invitation token authorizes onboarding state establishment before a user session exists.',
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
