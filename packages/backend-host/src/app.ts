import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { doubleCsrf } from 'csrf-csrf';
import { config } from '@enterpriseglue/shared/config/index.js';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { registerRoutes } from './routes/index.js';

interface CreateAppOptions {
  registerBaseRoutes?: boolean;
  registerRoutes?: boolean;
  includeRateLimiting?: boolean;
  includeDocs?: boolean;
  registerFinalMiddleware?: boolean;
}

export function registerBaseRoutes(app: express.Express): void {
  registerRoutes(app);
}

export function registerFinalMiddleware(
  app: express.Express,
  options: { includeDocs?: boolean } = {}
): void {
  const { includeDocs = true } = options;

  if (includeDocs) {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(generateOpenApi()));
  }

  // Error handling middleware (must be last)
  app.use(errorHandler);
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  const {
    registerBaseRoutes: registerBaseRoutesOption,
    registerRoutes: registerRoutesOption,
    includeRateLimiting = true,
    includeDocs = true,
    registerFinalMiddleware: shouldRegisterFinalMiddleware = true,
  } = options;
  const shouldRegisterBaseRoutes = registerBaseRoutesOption ?? registerRoutesOption ?? true;

  app.disable('x-powered-by');

  // Trust proxy for correct req.ip behind reverse proxies
  // Express 5 requires a number for hop-count (string '1' would be treated as an IP address)
  const trustProxyValue = /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy;
  app.set('trust proxy', trustProxyValue);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // CORS configuration for cookie-based authentication
  app.use(cors({
    origin: config.frontendUrl, // Exact origin (not wildcard) for credentials
    credentials: true, // Allow cookies to be sent
    exposedHeaders: ['X-CSRF-Token'], // Let the SPA read the CSRF token from response headers
  }));

  // Logging
  app.use(morgan('dev', {
    stream: {
      write: (message: string) => {
        const line = String(message || '').trim();
        if (line) logger.info(line);
      },
    },
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use((req, _res, next) => {
    const cookieHeader = req.headers.cookie;
    const cookies: Record<string, string> = Object.create(null);

    if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
      for (const part of cookieHeader.split(';')) {
        const [nameRaw, ...rest] = part.trim().split('=');
        if (!nameRaw || nameRaw === '__proto__' || nameRaw === 'constructor' || nameRaw === 'prototype') continue;

        const valueRaw = rest.join('=') || '';
        try {
          cookies[nameRaw] = decodeURIComponent(valueRaw);
        } catch {
          cookies[nameRaw] = valueRaw;
        }
      }
    }

    req.cookies = cookies;
    next();
  });

  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => config.jwtSecret,
    getSessionIdentifier: (req) => req.cookies?.refreshToken ?? req.cookies?.accessToken ?? req.ip ?? '',
    cookieName: 'csrf_secret',
    cookieOptions: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
    },
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
    skipCsrfProtection: (req) => {
      // Skip CSRF for login/refresh and CSRF token fetch (these endpoints validate credentials directly)
      if (req.path === '/api/auth/login' || req.path === '/api/auth/refresh' || req.path === '/api/csrf-token') return true;

      const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
      const hasBearer = authHeader.startsWith('Bearer ');
      const hasCookieAccessToken = Boolean((req as any).cookies?.accessToken);

      // CSRF is relevant for cookie-authenticated requests; Bearer-token APIs are not vulnerable.
      if (hasBearer || !hasCookieAccessToken) return true;

      return false;
    },
  });

  // Global CSRF protection for cookie-authenticated routes.
  // skipCsrfProtection above will bypass this for safe/Bearer-only endpoints.
  app.use(doubleCsrfProtection);

  // Endpoint for the frontend to obtain a CSRF token.
  // This will also set the CSRF secret cookie defined above.
  app.get('/api/csrf-token', (req, res) => {
    const csrfToken = generateCsrfToken(req, res);
    res.setHeader('X-CSRF-Token', csrfToken);
    res.json({ csrfToken });
  });

  // CSRF error handler — doubleCsrfProtection calls next(err) on invalid tokens.
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf'))) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next(err);
  });

  // Send the CSRF token in a response header for the SPA to echo back in X-CSRF-Token.
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const token = generateCsrfToken(req as any, res as any);
      res.setHeader('X-CSRF-Token', token);
    } catch {
      // ignore — token generation may fail for skipped requests
    }
    next();
  });

  // Apply global rate limiting (100000 requests per 15 minutes per user/IP)
  if (includeRateLimiting) {
    app.use('/api', apiLimiter);
    app.use('/starbase-api', apiLimiter);
    app.use('/vcs-api', apiLimiter);
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Register all application routes
  if (shouldRegisterBaseRoutes) {
    registerBaseRoutes(app);
  }

  if (shouldRegisterFinalMiddleware) {
    registerFinalMiddleware(app, { includeDocs });
  }

  return app;
}
