/**
 * Google OAuth Authentication Routes
 * Handles OAuth flow: initiate login, callback, and token exchange
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { logger } from '@shared/utils/logger.js';
import { 
  isGoogleAuthEnabled, 
  getGoogleAuthorizationUrl, 
  exchangeGoogleCodeForTokens,
  extractGoogleUserInfo,
  provisionGoogleUser
} from '@shared/services/google.js';
import { generateAccessToken, generateRefreshToken } from '@shared/utils/jwt.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { config } from '@shared/config/index.js';

const router = Router();

/**
 * Check if Google auth is enabled
 * GET /api/auth/google/status
 */
router.get('/api/auth/google/status', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const enabled = await isGoogleAuthEnabled();
  res.json({ 
    enabled,
    message: enabled ? 'Google authentication is available' : 'Google is not configured'
  });
}));

/**
 * Initiate Google OAuth flow
 * GET /api/auth/google
 * Redirects user to Google login page
 */
router.get('/api/auth/google', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const enabled = await isGoogleAuthEnabled();
  if (!enabled) {
    return res.status(503).json({ 
      error: 'Google authentication is not configured',
      message: 'Please configure Google OAuth in Platform Settings or environment variables'
    });
  }

  return res.redirect('/api/auth/google/start');
}));

/**
 * Handle Google OAuth callback
 * GET /api/auth/google/callback
 * Google redirects here after user authenticates
 */
router.get('/api/auth/google/callback', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

    // Handle Google errors
    if (error) {
      logger.error('[Google Auth] OAuth error:', error, error_description);
      const errorUrl = `${config.frontendUrl}/login?error=google_auth_failed&message=${encodeURIComponent(error_description as string || error as string)}`;
      return res.redirect(errorUrl);
    }

    // Validate required parameters
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Validate state (CSRF protection)
    const storedState = req.cookies.oauth_state;
    if (!storedState || storedState !== state) {
      logger.error('[Google Auth] State mismatch - possible CSRF attack');
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Clear state cookie
    res.clearCookie('oauth_state');

    logger.info('[Google Auth] Exchanging code for tokens...');

    // Exchange authorization code for tokens
    const tokenResponse = await exchangeGoogleCodeForTokens(code);
    
    logger.info('[Google Auth] Token exchange successful');

    // Extract user info from ID token
    const userInfo = extractGoogleUserInfo(tokenResponse.payload);
    
    logger.info('[Google Auth] User info extracted:', { 
      sub: userInfo.sub, 
      email: userInfo.email,
      name: userInfo.name 
    });

    // Create or update user (JIT provisioning)
    const user = await provisionGoogleUser(userInfo);
    
    if (!user) {
      throw new Error('Failed to provision user');
    }
    
    logger.info('[Google Auth] User provisioned:', { 
      id: user.id, 
      email: user.email, 
      platformRole: user.platformRole,
      isNew: !user.lastLoginAt 
    });

    // Check if user is active
    if (!user.isActive) {
      logger.warn('[Google Auth] User account is deactivated:', user.email);
      
      await logAudit({
        action: AuditActions.LOGIN_FAILED,
        userId: user.id,
        details: { reason: 'Account deactivated', provider: 'google' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const errorUrl = `${config.frontendUrl}/login?error=account_deactivated&message=Your account has been deactivated`;
      return res.redirect(errorUrl);
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Log successful login
    await logAudit({
      action: AuditActions.LOGIN_SUCCESS,
      userId: user.id,
      details: { provider: 'google', googleId: userInfo.sub },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('[Google Auth] Login successful:', user.email);

    // Set tokens in HTTP-only cookies
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: config.jwtAccessTokenExpires * 1000,
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: config.jwtRefreshTokenExpires * 1000,
    });

    res.redirect(`${config.frontendUrl}/`);
}));

export default router;
