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
  if (req.user?.userId) {
    return `user:${req.user.userId}`;
  }
  
  // Use x-forwarded-for header if behind a proxy, otherwise req.ip
  // This properly handles both IPv4 and IPv6 addresses
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress;
  
  return `ip:${ip}`;
}

/**
 * General API rate limiter
 * Development: 1000 requests per 15 minutes
 * Production: 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // Generous limit for dev
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
});

/**
 * Engine API rate limiter
 * Production: 2000 requests per 15 minutes per user
 * Development: 10000 requests per 15 minutes per user
 */
export const engineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 2000 : 10000,
  message: { error: 'Too many engine requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return getClientIdentifier(req);
  },
});

/**
 * Strict rate limiter for authentication endpoints
 * Development: 50 requests per 15 minutes (for testing)
 * Production: 5 requests per 15 minutes per IP
 * Protects against brute force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 50, // More lenient for dev
  skipSuccessfulRequests: true, // Don't count successful requests
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Create user rate limiter (admin only)
 * 20 user creations per hour
 * Prevents mass account creation abuse
 */
export const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit to 20 user creations per hour
  message: { error: 'Too many user creation requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Password reset rate limiter
 * 3 requests per hour per IP
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit to 3 password reset attempts per hour
  message: { error: 'Too many password reset attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Project creation rate limiter
 * 10 projects per hour per user
 */
export const projectCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit to 10 projects per hour
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
 * 100 file operations per 5 minutes per user
 */
export const fileOperationsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Limit to 100 file operations per 5 minutes
  message: { error: 'Too many file operations, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return getClientIdentifier(req);
  },
});

