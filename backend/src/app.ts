import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import csrf from 'csurf';
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

  // CORS configuration for cookie-based authentication
  app.use(cors({
    origin: config.frontendUrl, // Exact origin (not wildcard) for credentials
    credentials: true, // Allow cookies to be sent
  }));

  // Logging
  app.use(morgan('dev'));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const csrfProtection = csrf({
    cookie: {
      key: 'csrf_secret',
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
    },
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

    csrfProtection(req as any, res as any, (err: any) => {
      if (err) return res.status(403).json({ error: 'Invalid CSRF token' });

      // Send the CSRF token in a response header for the SPA to echo back in X-CSRF-Token.
      // Using a header instead of a non-httpOnly cookie avoids CWE-1004.
      if (typeof (req as any).csrfToken === 'function') {
        try {
          const token = (req as any).csrfToken();
          res.setHeader('X-CSRF-Token', token);
        } catch {
          // ignore
        }
      }

      next();
    });
  });

  // Apply global rate limiting (100 requests per 15 minutes per IP)
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
