/**
 * Interfaces Layer
 * 
 * API / HTTP layer - controllers, middleware, and schemas.
 * This is the entry point for external requests.
 * 
 * Import Rule: Can import from all layers (domain, application, infrastructure).
 * This layer wires everything together.
 */

// Re-export middleware during migration
export { requireAuth, requireCloudAccountOrTenantAuth, requireAdmin, requireOnboarding, optionalAuth } from '../middleware/auth.js';
export { errorHandler, asyncHandler, Errors } from '../middleware/errorHandler.js';
export { apiLimiter, authLimiter } from '../middleware/rateLimiter.js';
export { 
  requireTenantRole, 
  requireTenantAdmin,
  resolveTenantContext,
  checkTenantAdmin,
  type TenantContext,
  type TenantRole,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_SLUG
} from '../middleware/tenant.js';
export { auditLog } from '../middleware/auditLog.js';

// Re-export validation utilities
export { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
