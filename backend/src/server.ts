import 'reflect-metadata';
import { createApp, registerBaseRoutes, registerFinalMiddleware } from './app.js';
import { config } from '@shared/config/index.js';
import { ensureSchemaExists, initializeDatabase } from '@shared/db/run-migrations.js';
import { bootstrapAdmin, backfillKnownUserProfiles, backfillMissingPlatformRoles } from '@shared/db/bootstrap.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requirePlatformAdmin } from '@shared/middleware/platformAuth.js';
import { startBatchPoller } from './poller/batchPoller.js';
import { getConnectionPool, ConnectionPool } from '@shared/db/db-pool.js';
import { loadEnterpriseBackendPlugin } from './enterprise/loadEnterpriseBackendPlugin.js';
const app = createApp({ registerBaseRoutes: false, registerFinalMiddleware: false });

// Expose middleware to enterprise plugin via app.locals
app.locals.requireAuth = requireAuth;
app.locals.requirePlatformAdmin = requirePlatformAdmin;

const enterprisePlugin = await loadEnterpriseBackendPlugin();
app.locals.enterprisePluginLoaded = Boolean(
  enterprisePlugin && (enterprisePlugin.registerRoutes || enterprisePlugin.migrateEnterpriseDatabase)
);
console.log(
  `[Enterprise] Backend plugin status: loaded=${app.locals.enterprisePluginLoaded}, ` +
    `registerRoutes=${Boolean(enterprisePlugin.registerRoutes)}, ` +
    `migrateEnterpriseDatabase=${Boolean(enterprisePlugin.migrateEnterpriseDatabase)}`
);

try {
  // Pass database-agnostic connection pool to enterprise plugin.
  // getConnectionPool() only supports postgres today; on other db types
  // we skip enterprise route registration gracefully.
  if (enterprisePlugin.registerRoutes) {
    const pool = getConnectionPool();
    await enterprisePlugin.registerRoutes(app as any, {
      connectionPool: pool,
      config,
    } as any);
  }
} catch (error) {
  // If the pool isn't implemented for this database type, log and continue
  // without enterprise routes rather than crashing the server.
  if (error instanceof Error && error.message.includes('ConnectionPool raw SQL adapter is not implemented')) {
    console.warn(`[Enterprise] Skipping enterprise routes: ${error.message}`);
  } else {
    console.error('Failed to register enterprise routes:', error);
    throw error;
  }
}

registerBaseRoutes(app);
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
      connectionPool: getConnectionPool(),
      config,
    } as any);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ConnectionPool raw SQL adapter is not implemented')) {
      console.warn(`[Enterprise] Skipping enterprise migrations: ${error.message}`);
    } else {
      console.error('Failed to run enterprise migrations:', error);
      throw error;
    }
  }
}

// Bootstrap admin account on first run.
// Always grant platform admin to the bootstrap user — the EE plugin can
// layer its own tenant-level role management on top.
await bootstrapAdmin({ allowPlatformAdmin: true });
await backfillMissingPlatformRoles();

await backfillKnownUserProfiles({ allowPlatformAdmin: true });

// Seed Git providers on first run
try {
  const { seedGitProviders } = await import('@shared/db/seed/gitProviders.js');
  await seedGitProviders();
} catch (error) {
  console.error('Failed to seed Git providers:', error);
}

// Seed default environment tags on first run
try {
  const { environmentTagService } = await import('@shared/services/platform-admin/EnvironmentTagService.js');
  await environmentTagService.seedDefaults();
} catch (error) {
  console.error('Failed to seed environment tags:', error);
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Voyager API listening on http://localhost:${config.port}`);
  console.log(`API docs: http://localhost:${config.port}/api/docs`);
  
  // Debug: Check Microsoft Entra ID configuration
  if (config.microsoftClientId && config.microsoftClientSecret && config.microsoftTenantId) {
    console.log('✅ Microsoft Entra ID: Configured');
    console.log(`   Client ID: ${config.microsoftClientId.substring(0, 8)}...`);
    console.log(`   Tenant ID: ${config.microsoftTenantId.substring(0, 8)}...`);
  } else {
    console.log('⚠️  Microsoft Entra ID: Not configured');
    console.log('   Missing:', [
      !config.microsoftClientId && 'CLIENT_ID',
      !config.microsoftClientSecret && 'CLIENT_SECRET',
      !config.microsoftTenantId && 'TENANT_ID'
    ].filter(Boolean).join(', '));
  }
});

// Start background pollers
startBatchPoller();

// Graceful shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
