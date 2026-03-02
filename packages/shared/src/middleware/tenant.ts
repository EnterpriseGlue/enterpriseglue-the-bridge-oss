/**
 * Tenant Middleware for OSS (Single-Tenant Mode)
 * 
 * OSS uses unified tenant-slug routing (/t/:tenantSlug/*) for compatibility with EE.
 * The middleware extracts the tenant slug from URL params but always uses the default tenant.
 * Full multi-tenancy support (real tenant resolution) is available in the Enterprise Edition.
 */

import { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';

export type TenantRole = 'tenant_admin' | 'member';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
}

// Default tenant for OSS single-tenant mode
export const DEFAULT_TENANT_ID = 'default-tenant-id';
export const DEFAULT_TENANT_SLUG = 'default';

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      tenantRole?: TenantRole;
    }
  }
}

/**
 * Extract tenant slug from request (URL params, header, or path)
 */
function extractTenantSlug(req: Request): string | null {
  // From URL params (e.g., /t/:tenantSlug/...)
  const fromParams = (req.params as Record<string, string>)?.tenantSlug;
  if (typeof fromParams === 'string' && fromParams.trim()) {
    return fromParams.trim();
  }

  // From header (for API clients)
  const header = req.headers['x-tenant-slug'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }

  return null;
}

/**
 * OSS stub: Extracts tenant slug from URL but always uses default tenant context.
 * In OSS single-tenant mode, any tenant slug is accepted but ignored.
 * EE plugin overrides this with real tenant resolution.
 */
export function resolveTenantContext(_options?: { required?: boolean }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    // Extract slug from URL (for logging/debugging) but use default tenant
    const slug = extractTenantSlug(req) || DEFAULT_TENANT_SLUG;
    
    // In OSS single-tenant mode, always use default tenant regardless of slug
    req.tenant = { tenantId: DEFAULT_TENANT_ID, tenantSlug: slug };
    next();
  };
}

/**
 * OSS stub: Platform admins pass through, others get tenant_admin role by default.
 * Multi-tenancy roles are an EE-only feature.
 */
export function requireTenantRole(..._allowedRoles: TenantRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw Errors.unauthorized('Authentication required');
    }

    // In OSS single-tenant mode, all authenticated users have tenant_admin role
    req.tenantRole = 'tenant_admin';
    next();
  };
}

/**
 * Convenience middleware: require tenant admin or platform admin
 */
export const requireTenantAdmin = requireTenantRole('tenant_admin');

/**
 * OSS stub: All authenticated users are considered tenant admins.
 * Multi-tenancy authorization is an EE-only feature.
 */
export async function checkTenantAdmin(req: Request, _tenantId: string): Promise<boolean> {
  if (!req.user) {
    throw Errors.unauthorized('Authentication required');
  }

  // In OSS single-tenant mode, all authenticated users are tenant admins
  return true;
}
