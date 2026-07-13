import type { AuthenticatedSessionContext } from '@enterpriseglue/shared/contracts/auth.js';

/**
 * Build the response-only identity context for an authenticated user request.
 * Tenant scope is request-derived and must never be inferred from a role.
 */
export function createAuthenticatedSessionContext(
  userId: string,
  tenantId: string | null | undefined,
): AuthenticatedSessionContext {
  return {
    principal: { type: 'user', id: userId },
    tenant: { id: tenantId ?? null },
  };
}
