import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { XSRF_HEADER_NAME } from '@enterpriseglue/shared/utils/xsrf.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { runWithBpmnEngineRequestContext } from '@enterpriseglue/shared/services/bpmn-engine-request-context.js';
import { installBrowserRequestProtection } from './middleware/browser-request-protection.js';
import { registerRoutes } from './routes/index.js';
import { registerPluginPlatformRoutes } from './plugins/pluginRuntime.js';
import type { NotificationTenantResolver } from '@enterpriseglue/enterprise-plugin-api/backend';
import { getConfigBootstrapMetrics, getConfigBootstrapStatus } from './services/configBundleBootstrap.js';
import { getEngineTenancyMetrics } from './services/engineTenancyMetrics.js';
import { getLoginExperienceMetrics } from './services/loginExperienceMetrics.js';

interface CreateAppOptions {
  registerBaseRoutes?: boolean;
  registerRoutes?: boolean;
  includeRateLimiting?: boolean;
  includeDocs?: boolean;
  registerFinalMiddleware?: boolean;
  notificationTenantResolver?: NotificationTenantResolver;
}

export function registerBaseRoutes(
  app: express.Express,
  options: {
    notificationTenantResolver?: NotificationTenantResolver;
    /** Keep HTTP registration identical while allowing API-only replicas. */
    startPluginWorkers?: boolean;
  } = {}
): void {
  // Plugin routes must precede the root-shaped tenant compatibility router.
  // That router intentionally fails closed when a pooled request has neither
  // a tenant path nor a verified tenant host, and would otherwise intercept
  // canonical plugin paths such as /api/t/:tenantSlug/apps first.
  registerPluginPlatformRoutes(app, undefined, undefined, {
    ...(options.startPluginWorkers === undefined
      ? {}
      : {
          startAvailabilityWorker: options.startPluginWorkers,
          startEventWorker: options.startPluginWorkers,
          startScheduleWorker: options.startPluginWorkers,
          startEngineEventPoller: options.startPluginWorkers &&
            process.env.ENTERPRISEGLUE_PLUGIN_ENGINE_EVENT_POLLING_ENABLED === 'true',
        }),
  });
  registerRoutes(app, options);
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
    notificationTenantResolver,
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
        workerSrc: ["'none'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        manifestSrc: ["'self'"],
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
    exposedHeaders: [XSRF_HEADER_NAME], // Expose the same token to non-cookie API clients
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
  // SCIM and other standards-based JSON protocols use structured syntax
  // suffix media types such as application/scim+json.
  app.use(express.json({ limit: '2mb', type: ['application/json', 'application/*+json'] }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use((req, _res, next) => {
    const headerRequestId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
    const requestId = Array.isArray(headerRequestId) ? headerRequestId[0] : headerRequestId;
    runWithBpmnEngineRequestContext(
      { requestId: typeof requestId === 'string' && requestId.trim() ? requestId.trim() : undefined },
      next
    );
  });
  installBrowserRequestProtection(app);

  // Apply global rate limiting (100000 requests per 15 minutes per user/IP)
  if (includeRateLimiting) {
    app.use('/api', apiLimiter);
    app.use('/starbase-api', apiLimiter);
    app.use('/vcs-api', apiLimiter);
  }

  app.get('/health', (_req, res) => {
    const configBootstrap = getConfigBootstrapStatus();
    res.json({ status: configBootstrap.status === 'failed' ? 'degraded' : 'ok', configBootstrap });
  });

  app.get('/ready', (_req, res) => {
    const configBootstrap = getConfigBootstrapStatus();
    const ready = configBootstrap.status !== 'failed';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', configBootstrap });
  });

  app.get('/metrics', async (_req, res) => {
    const metrics = [
      getConfigBootstrapMetrics().trimEnd(),
      (await getEngineTenancyMetrics()).trimEnd(),
      getLoginExperienceMetrics().trimEnd(),
      '',
    ].join('\n');
    res.type('text/plain; version=0.0.4').send(metrics);
  });

  // Register all application routes
  if (shouldRegisterBaseRoutes) {
    registerBaseRoutes(app, { notificationTenantResolver });
  }

  if (shouldRegisterFinalMiddleware) {
    registerFinalMiddleware(app, { includeDocs });
  }

  return app;
}
