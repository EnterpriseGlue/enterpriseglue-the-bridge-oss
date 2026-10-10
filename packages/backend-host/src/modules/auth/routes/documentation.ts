import { DocumentationLogoutResponseSchema, DocumentationConfigurationResponseSchema, DocumentationGrantResponseSchema, DocumentationExchangeResponseSchema, DocumentationAccessResponseSchema } from '@enterpriseglue/shared/schemas/auth/documentation.js';
import { Router } from 'express';
import { apiLimiter, identityFlowLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { requireCloudAccountOrTenantAuth, requireDocumentationAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { documentationConfiguration, requireDocumentationGatewaySecret, verifyDocumentationIdentity, DocumentationExchangeRequestSchema, DocumentationGrantRequestSchema } from '@enterpriseglue/shared/utils/documentation-identity.js';
import { documentationSessionService } from '@enterpriseglue/shared/services/DocumentationSessionService.js';

const router = Router();
router.use('/api/auth/documentation', (_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try { documentationConfiguration(); next(); } catch (error) { next(error); }
});
router.get('/api/auth/documentation/configuration', apiLimiter, (_req, res) => {
  res.json(DocumentationConfigurationResponseSchema.parse({ documentationOrigin: documentationConfiguration().origin, accountOrigin: new URL(config.frontendUrl).origin }));
});
router.post('/api/auth/documentation/grant', apiLimiter, identityFlowLimiter, requireCloudAccountOrTenantAuth, validateBody(DocumentationGrantRequestSchema), asyncHandler(async (req, res) => {
  // Grants are a same-origin browser operation; a cross-site form must not mint one.
  if (req.get('origin') !== new URL(config.frontendUrl).origin) throw Errors.forbidden('Same-origin documentation request required');
  const code = await documentationSessionService.grant(req.user!, req.body.challenge);
  const callback = new URL('/auth/callback', documentationConfiguration().origin);
  callback.searchParams.set('code', code); callback.searchParams.set('state', req.body.state);
  res.json(DocumentationGrantResponseSchema.parse({ callbackUrl: callback.toString() }));
}));
router.post('/api/auth/documentation/exchange', apiLimiter, identityFlowLimiter, validateBody(DocumentationExchangeRequestSchema), requireDocumentationAuth('grant'), asyncHandler(async (req, res) => {
  res.json(DocumentationExchangeResponseSchema.parse({ session: await documentationSessionService.exchange(req.body.code, req.body.verifier) }));
}));
router.get('/api/auth/documentation/session', apiLimiter, requireDocumentationAuth('session'), (_req, res) => {
  res.json(DocumentationAccessResponseSchema.parse({ authenticated: true, permission: 'documentation:read' }));
});
router.post('/api/auth/documentation/logout', apiLimiter, asyncHandler(async (req, res) => {
  // Revocation must also work when the source account becomes ineligible.
  // A signed documentation credential and gateway proof authorize only removal of its own identifier.
  requireDocumentationGatewaySecret(req.get('x-enterpriseglue-documentation-key'));
  const token = req.get('authorization')?.replace(/^Bearer /i, '') || '';
  verifyDocumentationIdentity(token, 'documentation_session');
  await documentationSessionService.revokeSession(token);
  res.json(DocumentationLogoutResponseSchema.parse({ signedOut: true }));
}));
export default router;
