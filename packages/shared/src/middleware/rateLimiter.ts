/**
 * Rate Limiting Middleware
 * Prevents abuse and brute force attacks
 */

import rateLimit from 'express-rate-limit';

/**
 * Helper to properly generate IP-based keys with IPv6 support
 */
function getClientIdentifier(req: any): string {
  // Use user ID if authenticated, otherwise fall back to IP
  const identity = req.user?.userId
    ? `user:${req.user.userId}`
    : `ip:${(req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress}`;

  const prefix = typeof req.rateLimitKeyPrefix === 'string' && req.rateLimitKeyPrefix.trim()
    ? `${req.rateLimitKeyPrefix.trim()}:`
    : '';

  return `${prefix}${identity}`;
}

/**
 * Notifications endpoints can be noisy (filtering/polling).
 * Exempt them from global API rate limiting.
 */
export function isNotificationsRequest(req: any): boolean {
  const path = typeof req.path === 'string' ? req.path : '';
  const originalUrl = typeof req.originalUrl === 'string' ? req.originalUrl : '';
  return path.startsWith('/notifications') || originalUrl.startsWith('/api/notifications');
}

/**
 * Auth endpoints should not be throttled by the global API limiter.
 * Login is protected by authLimiter; refresh/logout should stay responsive.
 */
function isAuthRequest(req: any): boolean {
  const path = typeof req.path === 'string' ? req.path : '';
  const originalUrl = typeof req.originalUrl === 'string' ? req.originalUrl : '';
  return path.startsWith('/auth') || originalUrl.startsWith('/api/auth');
}

/**
 * General API rate limiter
 * Development: 10000000 requests per 15 minutes
 * Production: 100000 requests per 15 minutes per user/IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100000 : 10000000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skip: (req) => isNotificationsRequest(req) || isAuthRequest(req),
  keyGenerator: (req) => {
    return getClientIdentifier(req);
  },
});

/**
 * Engine API rate limiter
 * Production: 2000000 requests per 15 minutes per user
 * Development: 10000000 requests per 15 minutes per user
 */
export const engineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 2000000 : 10000000,
  message: { error: 'Too many engine requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return getClientIdentifier(req);
  },
});

/**
 * Strict rate limiter for authentication endpoints
 * Development: 1000000 requests per 15 minutes (for local testing)
 * Production: 1000 requests per 15 minutes per IP
 * Protects against brute force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 1000000, // More lenient for dev
  skipSuccessfulRequests: true, // Don't count successful requests
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Create user rate limiter (admin only)
 * 1000 user creations per hour
 * Prevents mass account creation abuse
 */
export const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // Limit to 1000 user creations per hour
  message: { error: 'Too many user creation requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Password reset rate limiter
 * 300 requests per hour per IP
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 300, // Limit to 300 password reset attempts per hour
  message: { error: 'Too many password reset attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Project creation rate limiter
 * 500 projects per hour per user
 */
export const projectCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 500, // Limit to 500 projects per hour
  message: { error: 'Too many projects created, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by user ID instead of IP for authenticated endpoints
    return getClientIdentifier(req);
  },
});

/**
 * File operations rate limiter
 * 25000 file operations per 5 minutes per user
 */
export const fileOperationsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 25000, // Limit to 25000 file operations per 5 minutes
  message: { error: 'Too many file operations, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return getClientIdentifier(req);
  },
});

/**
 * Audit endpoints rate limiter
 * Production: 1000 requests per 15 minutes per user
 */
export const auditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 1000000,
  message: { error: 'Too many audit requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIdentifier(req),
});

/**
 * Notifications endpoints rate limiter
 * Production: 1200 requests per 5 minutes per user
 */
export const notificationsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'production' ? 1200 : 1000000,
  message: { error: 'Too many notification requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIdentifier(req),
});

/**
 * Dashboard endpoints rate limiter
 * Production: 600 requests per 15 minutes per user
 */
export const dashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 600 : 1000000,
  message: { error: 'Too many dashboard requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIdentifier(req),
});

/**
 * Mission control task endpoints rate limiter
 * Production: 1000 requests per 5 minutes per user
 */
export const missionControlLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 1000000,
  message: { error: 'Too many mission control requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIdentifier(req),
});

/**
 * Password reset token verification limiter
 * Production: 600 requests per 15 minutes per IP
 */
export const passwordResetVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 600 : 1000000,
  message: { error: 'Too many token verification attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});


