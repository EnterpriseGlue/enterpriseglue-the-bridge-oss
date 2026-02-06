import { Router } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { logger } from '@shared/utils/logger.js';
import bcrypt from 'bcryptjs';
import { verifyToken } from '@shared/utils/jwt.js';
import { generateAccessToken } from '@shared/utils/jwt.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { IsNull, MoreThan } from 'typeorm';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js';
import { config } from '@shared/config/index.js';

const router = Router();

/**
 * POST /api/auth/refresh
 * Exchange refresh token for new access token
 * Reads refresh token from httpOnly cookie
 */
router.post('/api/auth/refresh', apiLimiter, asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!refreshToken) {
    throw Errors.unauthorized('No refresh token provided');
  }

  // Verify refresh token
  const payload = verifyToken(refreshToken);

  if (payload.type !== 'refresh') {
    throw Errors.unauthorized('Invalid token type');
  }

  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const refreshTokenRepo = dataSource.getRepository(RefreshToken);

  // Get user
  const user = await userRepo.findOneBy({ id: payload.userId, isActive: true });

  if (!user) {
    throw Errors.validation('User not found or inactive');
  }

  // Verify refresh token exists and is not revoked
  const tokenResult = await refreshTokenRepo.find({
    where: {
      userId: user.id,
      revokedAt: IsNull(),
      expiresAt: MoreThan(Date.now()),
    },
    select: ['tokenHash'],
  });

  // Check if any of the stored token hashes match the provided token
  let isValidToken = false;
  for (const row of tokenResult) {
    const isMatch = await bcrypt.compare(refreshToken, row.tokenHash);
    if (isMatch) {
      isValidToken = true;
      break;
    }
  }

  if (!isValidToken) {
    throw Errors.unauthorized('Invalid refresh token');
  }

  // Generate new access token
  const accessToken = generateAccessToken(user);

  // Set new access token as httpOnly cookie
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: config.jwtAccessTokenExpires * 1000,
    path: '/',
  });

  res.json({
    expiresIn: config.jwtAccessTokenExpires,
  });
}));

export default router;
