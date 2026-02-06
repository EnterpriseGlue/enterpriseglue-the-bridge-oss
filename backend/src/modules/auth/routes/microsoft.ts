/**
 * Microsoft Entra ID OAuth Authentication Routes
 * Handles OAuth flow: initiate login, callback, and token exchange
 */

import { Router, Request, Response } from 'express';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { logger } from '@shared/utils/logger.js';
import { 
  isMicrosoftAuthEnabled, 
  getAuthorizationUrl, 
  exchangeCodeForTokens,
  extractUserInfo,
  provisionMicrosoftUser
} from '@shared/services/microsoft.js';
import { generateAccessToken, generateRefreshToken } from '@shared/utils/jwt.js';
import { logAudit, AuditActions } from '@shared/services/audit.js';
import { config } from '@shared/config/index.js';

const router = Router();

/**
 * Check if Microsoft Entra ID is enabled
 * GET /api/auth/microsoft/status
 */
router.get('/api/auth/microsoft/status', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const enabled = isMicrosoftAuthEnabled();
  res.json({ 
    enabled,
    message: enabled ? 'Microsoft Entra ID authentication is available' : 'Microsoft Entra ID is not configured'
  });
}));

/**
 * Initiate Microsoft OAuth flow
 * GET /api/auth/microsoft
 * Redirects user to Microsoft login page
 */
router.get('/api/auth/microsoft', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (!isMicrosoftAuthEnabled()) {
      return res.status(503).json({ 
        error: 'Microsoft Entra ID authentication is not configured',
        message: 'Please configure MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID in your environment'
      });
    }

    // Do not redirect to external providers from a handler that reads HTTP params.
    // Redirect internally to a dedicated start route.
    return res.redirect('/api/auth/microsoft/start');
}));

/**
 * Handle Microsoft OAuth callback
 * GET /api/auth/microsoft/callback
 * Microsoft redirects here after user authenticates
 */
router.get('/api/auth/microsoft/callback', apiLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

    // Handle Microsoft errors
    if (error) {
      logger.error('[Microsoft Auth] OAuth error:', error, error_description);
      
      // Sanitize error message: strip HTML, limit length, use only safe characters
      const rawMessage = String(error_description || error || 'Authentication failed');
      const safeMessage = rawMessage.replace(/<[^>]*>/g, '').slice(0, 200);
      const errorUrl = `${config.frontendUrl}/login?error=microsoft_auth_failed&message=${encodeURIComponent(safeMessage)}`;
      return res.redirect(errorUrl);
    }

    // Validate required parameters
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Validate state (CSRF protection)
    const storedState = req.cookies.oauth_state;
    if (!storedState || storedState !== state) {
      logger.error('[Microsoft Auth] State mismatch - possible CSRF attack');
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Clear state cookie
    res.clearCookie('oauth_state');

    logger.info('[Microsoft Auth] Exchanging code for tokens...');

    // Exchange authorization code for tokens
    const tokenResponse = await exchangeCodeForTokens(code);
    
    logger.info('[Microsoft Auth] Token exchange successful');

    // Extract user info from ID token
    const userInfo = extractUserInfo(tokenResponse.idTokenClaims);
    
    logger.info('[Microsoft Auth] User info extracted:', { 
      oid: userInfo.oid, 
      email: userInfo.email,
      name: userInfo.name 
    });

    // Create or update user (JIT provisioning)
    const user = await provisionMicrosoftUser(userInfo);
    
    if (!user) {
      throw new Error('Failed to provision user');
    }
    
    logger.info('[Microsoft Auth] User provisioned:', { 
      id: user.id, 
      email: user.email, 
      platformRole: user.platformRole,
      isNew: !user.lastLoginAt 
    });

    // Check if user is active
    if (!user.isActive) {
      logger.warn('[Microsoft Auth] User account is deactivated:', user.email);
      
      await logAudit({
        action: AuditActions.LOGIN_FAILED,
        userId: user.id,
        details: { reason: 'Account deactivated', provider: 'microsoft' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const errorUrl = `${config.frontendUrl}/login?error=account_deactivated&message=Your account has been deactivated`;
      return res.redirect(errorUrl);
    }

    // Generate JWT tokens (our own tokens for the session)
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Log successful login
    await logAudit({
      action: AuditActions.LOGIN_SUCCESS,
      userId: user.id,
      details: { provider: 'microsoft', entraId: userInfo.oid },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    logger.info('[Microsoft Auth] Login successful:', user.email);

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

    // Redirect directly to frontend root
    // Cookies are set, so AuthContext will automatically load the user
    res.redirect(`${config.frontendUrl}/`);
}));

export default router;
