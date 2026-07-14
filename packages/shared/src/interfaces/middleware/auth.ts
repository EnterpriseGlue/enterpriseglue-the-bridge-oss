/**
 * Compatibility entry point for consumers that historically imported auth
 * middleware through the interfaces package. Keep a single implementation so
 * principal and session-revocation checks cannot drift between export paths.
 */
export {
  requireAuth,
  requireAdmin,
  requireOnboarding,
  optionalAuth,
  type EnterprisePostAuthContext,
  type EnterprisePostAuthResolver,
} from '../../middleware/auth.js';
