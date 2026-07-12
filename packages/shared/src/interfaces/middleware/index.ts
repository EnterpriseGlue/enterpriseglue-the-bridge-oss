/**
 * Interfaces Layer - HTTP Middleware
 * 
 * Express middleware for authentication, authorization, validation,
 * rate limiting, error handling, and audit logging.
 * 
 * Phase 4: Middleware moved to interfaces layer.
 */

// Authentication & Authorization
export { requireAuth, requireAdmin, requireOnboarding, optionalAuth } from './auth.js';
export { requireApiClientAction, requireApiClientScope } from './apiClientAuth.js';
export { errorHandler, asyncHandler, Errors } from './errorHandler.js';
export { apiLimiter, authLimiter } from './rateLimiter.js';
export { 
  requireTenantRole, 
  requireTenantAdmin,
  resolveTenantContext,
  checkTenantAdmin,
  type TenantContext,
  type TenantRole,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_SLUG
} from './tenant.js';
export { auditLog } from './auditLog.js';

// Validation
export { validateBody, validateQuery, validateParams } from './validate.js';

// Database
export { attachDatabase, getDb } from './database.js';

// Platform Auth
export { requirePlatformAdmin, requirePlatformRole, checkPlatformAdmin, isPlatformAdmin } from './platformAuth.js';

// Project Auth
export { requireProjectRole } from './projectAuth.js';

// Permission
export { requirePermission } from './requirePermission.js';
export { requireAction, requireInvitationCreateAction } from './requireAction.js';

// Authorization helper
export { authorize, auth } from './authorize.js';
