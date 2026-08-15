import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IsNull } from 'typeorm';
import { validateBody } from '@enterpriseglue/shared/middleware/validate.js';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { genericSamlService } from '@enterpriseglue/shared/services/platform-admin/GenericSamlService.js';
import { createSamlRequestId } from './sso-state.js';
import { signFederatedLogoutState } from '@enterpriseglue/shared/utils/samlRelayState.js';
import { LogoutResponseSchema } from '@enterpriseglue/shared/schemas/auth/session.js';
import { auditFromRequest, AuditActions, logAudit } from '@enterpriseglue/shared/services/audit.js';

const router = Router();

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
}).strict();

function providerConfiguration(provider: IdentityProvider): Record<string, unknown> {
  const parsed = JSON.parse(provider.configurationJson) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Provider configuration is invalid');
  return parsed as Record<string, unknown>;
}

async function currentProviderSession(
  sessions: RefreshToken[],
  presentedRefreshToken: string | undefined,
): Promise<RefreshToken | null> {
  if (!presentedRefreshToken) return null;
  // Bound expensive bcrypt comparisons while still covering an unusually high
  // number of concurrently signed-in browsers for one account.
  for (const session of sessions.slice(0, 200)) {
    if (await bcrypt.compare(presentedRefreshToken, session.tokenHash)) return session;
  }
  return null;
}

/**
 * POST /api/auth/logout
 * Revoke refresh token(s)
 */
router.post('/api/auth/logout', apiLimiter, requireAuth, validateBody(logoutSchema), asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;
  const now = Date.now();
  const dataSource = await getDataSource();
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);
  const activeSessions = await refreshTokenRepo.find({
    where: { userId: req.user!.userId, revokedAt: IsNull() },
    order: { createdAt: 'DESC' },
    take: 200,
  });
  const providerSession = await currentProviderSession(activeSessions, refreshToken);

  if (refreshToken) {
    // Revoke specific refresh token (actually revokes all non-revoked tokens for user)
    await refreshTokenRepo.update(
      { userId: req.user!.userId, revokedAt: IsNull() },
      { revokedAt: now }
    );
  } else {
    // Revoke all refresh tokens for user
    await refreshTokenRepo.update(
      { userId: req.user!.userId },
      { revokedAt: now }
    );
  }

  // Clear auth cookies
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });

  let federatedLogoutUrl: string | null = null;
  if (providerSession?.identityProviderId && providerSession.providerSubjectId) {
    try {
      const provider = await dataSource.getRepository(IdentityProvider).findOne({ where: { id: providerSession.identityProviderId } });
      if (provider?.isEnabled && provider.authenticationMode === 'direct') {
        const rawConfiguration = providerConfiguration(provider);
        if (provider.protocol === 'oidc') {
          federatedLogoutUrl = await genericOidcService.createLogoutRequest(
            rawConfiguration,
            signFederatedLogoutState(JSON.stringify({ providerId: provider.id, issuedAt: Date.now(), nonce: randomBytes(24).toString('base64url') })),
          );
        } else if (provider.protocol === 'saml') {
          const callbackUrl = typeof rawConfiguration.logoutCallbackUrl === 'string' ? new URL(rawConfiguration.logoutCallbackUrl) : null;
          if (!callbackUrl || callbackUrl.pathname !== `/api/auth/identity/${encodeURIComponent(provider.key)}/saml/logout`) {
            throw new Error('SAML logout callback does not match the provider route');
          }
          const requestId = createSamlRequestId();
          const relayState = signFederatedLogoutState(JSON.stringify({ providerId: provider.id, requestId, issuedAt: Date.now() }));
          const request = await genericSamlService.createLogoutRequest(rawConfiguration, relayState, {
            nameID: providerSession.providerSubjectId,
            nameIDFormat: providerSession.providerNameIdFormat || 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
            ...(providerSession.providerSessionId ? { sessionIndex: providerSession.providerSessionId } : {}),
          }, requestId);
          federatedLogoutUrl = request?.url || null;
        }
      }
    } catch (error) {
      // Local revocation is the security boundary and must succeed even when a
      // provider is unavailable or has withdrawn its logout endpoint.
      logger.warn('Federated logout initiation failed after local session revocation', {
        providerId: providerSession.identityProviderId,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  await logAudit(auditFromRequest(req, {
    action: AuditActions.LOGOUT,
    resourceType: 'session',
    details: {
      identityProviderId: providerSession?.identityProviderId || null,
      federatedLogoutInitiated: Boolean(federatedLogoutUrl),
    },
  }));
  res.json(LogoutResponseSchema.parse({ message: 'Logged out successfully', federatedLogoutUrl }));
}));

export default router;
