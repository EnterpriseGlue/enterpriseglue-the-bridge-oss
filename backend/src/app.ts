import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { doubleCsrf } from 'csrf-csrf';
import { config } from '@shared/config/index.js';
import { generateOpenApi } from '@shared/schemas/openapi.js';
import { errorHandler } from '@shared/middleware/errorHandler.js';
import { apiLimiter } from '@shared/middleware/rateLimiter.js';
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
  app.set('trust proxy', config.trustProxy);

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
  app.use(morgan('dev'));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => config.jwtSecret,
    getSessionIdentifier: (req) => req.cookies?.accessToken ?? req.ip ?? '',
    cookieName: 'csrf_secret',
    cookieOptions: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
    },
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
  });

  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    // Skip CSRF for login/refresh (these are not cookie-auth flows)
    if (req.path === '/api/auth/login' || req.path === '/api/auth/refresh') return next();

    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const hasBearer = authHeader.startsWith('Bearer ');
    const hasCookieAccessToken = Boolean((req as any).cookies?.accessToken);

    // CSRF is relevant for cookie-authenticated requests; Bearer-token APIs are not vulnerable.
    if (hasBearer || !hasCookieAccessToken) return next();

    doubleCsrfProtection(req as any, res as any, (err: any) => {
      if (err) return res.status(403).json({ error: 'Invalid CSRF token' });

      // Send the CSRF token in a response header for the SPA to echo back in X-CSRF-Token.
      // Using a header instead of a non-httpOnly cookie avoids CWE-1004.
      try {
        const token = generateCsrfToken(req as any, res as any);
        res.setHeader('X-CSRF-Token', token);
      } catch {
        // ignore
      }

      next();
    });
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
