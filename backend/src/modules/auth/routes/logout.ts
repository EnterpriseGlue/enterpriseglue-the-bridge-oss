import { Router } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { logger } from '@shared/utils/logger.js';
import { z } from 'zod';
import { requireAuth } from '@shared/middleware/auth.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { getDataSource } from '@shared/db/data-source.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { IsNull } from 'typeorm';
import { validateBody } from '@shared/middleware/validate.js';

const router = Router();

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

/**
 * POST /api/auth/logout
 * Revoke refresh token(s)
 */
router.post('/api/auth/logout', apiLimiter, requireAuth, validateBody(logoutSchema), asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;
  const now = Date.now();
  const dataSource = await getDataSource();
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);

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

  res.json({ message: 'Logged out successfully' });
}));

export default router;
