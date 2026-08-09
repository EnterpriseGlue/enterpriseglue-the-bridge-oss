import 'reflect-metadata';
import { createApp, registerBaseRoutes, registerFinalMiddleware } from './app.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { ensureSchemaExists, initializeDatabase } from '@enterpriseglue/shared/db/run-migrations.js';
import { bootstrapAdmin, bootstrapDefaultEmailConfig } from '@enterpriseglue/shared/db/bootstrap.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requirePlatformAdmin } from '@enterpriseglue/shared/middleware/platformAuth.js';
import { requireAction, requireCompositeAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { startBatchPollerIfActive } from './poller/batchPoller.js';
import { startSsoDiagnosticsPollerIfEnabled } from './poller/ssoDiagnosticsPoller.js';
import { startRuntimeInventoryPollerIfEnabled } from './poller/runtimeInventoryPoller.js';
import { startConfigBundleIdentityReplayPollerIfEnabled } from './poller/configBundleIdentityReplayPoller.js';
import { startConfigBundleRuntimeReconciliationPollerIfEnabled } from './poller/configBundleRuntimeReconciliationPoller.js';
import { startCamundaNativeGrantSnapshotRetentionPoller } from './poller/camundaNativeGrantSnapshotRetentionPoller.js';
import { getConfigBootstrapStatus, runConfigBundleBootstrap } from './services/configBundleBootstrap.js';
import { createLazyConnectionPool } from '@enterpriseglue/shared/db/db-pool.js';
import type { EnterpriseBackendContext } from '@enterpriseglue/enterprise-plugin-api/backend';
import { createEnterpriseDatabaseContext } from './services/enterpriseDatabaseContext.js';
import {
  buildEnterpriseBackendRouteOpenApiAuthzMetadata,
  loadEnterpriseBackendPlugin,
  requireDeclaredEnterpriseBackendRouteAction,
} from './enterprise/loadEnterpriseBackendPlugin.js';

export { createApp, registerBaseRoutes, registerFinalMiddleware } from './app.js';
export { loadEnterpriseBackendPlugin } from './enterprise/loadEnterpriseBackendPlugin.js';

export async function startServer() {
  const app = createApp({ registerBaseRoutes: false, registerFinalMiddleware: false });

  // Expose middleware to enterprise plugin via app.locals
  app.locals.requireAuth = requireAuth;
  app.locals.requirePlatformAdmin = requirePlatformAdmin;
  app.locals.requireAction = requireAction;
  app.locals.requireCompositeAction = requireCompositeAction;

  const enterprisePlugin = await loadEnterpriseBackendPlugin();
  const enterpriseContext: EnterpriseBackendContext = {
    database: createEnterpriseDatabaseContext({ databaseType: config.databaseType }),
    connectionPool: createLazyConnectionPool(),
    config,
    authz: {
      requireAction: (actionId: string, options?: Record<string, unknown>) =>
        requireAction(actionId, options as never),
      requireCompositeAction: (actionId: string, options?: Record<string, unknown>) =>
        requireCompositeAction(actionId, options as never),
      requireDeclaredAction: requireDeclaredEnterpriseBackendRouteAction,
      buildOpenApiAuthzMetadata: buildEnterpriseBackendRouteOpenApiAuthzMetadata,
    },
  };
  const notificationTenantResolver = await enterprisePlugin.getNotificationTenantResolver?.(enterpriseContext);
  const engineTenantReferenceResolver = await enterprisePlugin.getEngineTenantReferenceResolver?.(enterpriseContext);
  app.locals.engineTenantReferenceResolver = engineTenantReferenceResolver;
  app.locals.enterprisePluginLoaded = Boolean(
    enterprisePlugin && (
      enterprisePlugin.registerRoutes
      || enterprisePlugin.migrateEnterpriseDatabase
      || enterprisePlugin.getNotificationTenantResolver
      || enterprisePlugin.getEngineTenantReferenceResolver
    )
  );
  console.log(
    `[Enterprise] Backend plugin status: loaded=${app.locals.enterprisePluginLoaded}, ` +
      `registerRoutes=${Boolean(enterprisePlugin.registerRoutes)}, ` +
      `migrateEnterpriseDatabase=${Boolean(enterprisePlugin.migrateEnterpriseDatabase)}, ` +
      `getNotificationTenantResolver=${Boolean(enterprisePlugin.getNotificationTenantResolver)}, ` +
      `getEngineTenantReferenceResolver=${Boolean(enterprisePlugin.getEngineTenantReferenceResolver)}`
  );

  try {
    // Pass the portable TypeORM context plus the deprecated lazy raw-pool
    // compatibility path to the enterprise plugin.
    await enterprisePlugin.registerRoutes?.(app as any, enterpriseContext);
  } catch (error) {
    console.error('Failed to register enterprise routes:', error);
    throw error;
  }

  registerBaseRoutes(app, { notificationTenantResolver });
  registerFinalMiddleware(app);

  // Initialize database schema before starting server
  await initializeDatabase();

  // Enterprise schema and migrations only run when enterprise plugin is present
  if (enterprisePlugin.migrateEnterpriseDatabase) {
    try {
      const schema = config.enterpriseSchema;

      // Create enterprise schema if configured (and not 'public')
      if (schema && schema !== 'public') {
        await ensureSchemaExists(schema);
      }

      // Run enterprise migrations
      await enterprisePlugin.migrateEnterpriseDatabase({
        ...enterpriseContext,
      } as any);
    } catch (error) {
      console.error('Failed to run enterprise migrations:', error);
      throw error;
    }
  }

  // Bootstrap admin account on first run
  await bootstrapAdmin({ allowPlatformAdmin: !app.locals.enterprisePluginLoaded });
  await bootstrapDefaultEmailConfig();

  try {
    await runConfigBundleBootstrap({ tenantReferenceResolver: engineTenantReferenceResolver });
  } catch {
    console.error('Configuration bundle bootstrap failed:', getConfigBootstrapStatus());
    if (config.configFailClosed) throw new Error('Configuration bundle bootstrap failed');
  }

  // Seed Git providers on first run
  try {
    const { seedGitProviders } = await import('@enterpriseglue/shared/db/seed/gitProviders.js');
    await seedGitProviders();
  } catch (error) {
    console.error('Failed to seed Git providers:', error);
  }

  // Seed default environment tags on first run
  try {
    const { environmentTagService } = await import('@enterpriseglue/shared/services/platform-admin/EnvironmentTagService.js');
    await environmentTagService.seedDefaults();
  } catch (error) {
    console.error('Failed to seed environment tags:', error);
  }

  app.listen(config.port, () => {
    console.log(`Voyager API listening on http://localhost:${config.port}`);
    console.log(`API docs: http://localhost:${config.port}/api/docs`);

  });

  // Start background pollers
  void startBatchPollerIfActive();
  void startSsoDiagnosticsPollerIfEnabled();
  void startRuntimeInventoryPollerIfEnabled();
  void startConfigBundleIdentityReplayPollerIfEnabled();
  void startConfigBundleRuntimeReconciliationPollerIfEnabled();
  void startCamundaNativeGrantSnapshotRetentionPoller();

  // Graceful shutdown
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
