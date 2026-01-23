import 'reflect-metadata';
import { createApp, registerBaseRoutes, registerFinalMiddleware } from './app.js';
import { config } from '@shared/config/index.js';
import { initializeDatabase } from '@shared/db/run-migrations.js';
import { bootstrapAdmin, backfillKnownUserProfiles, backfillMissingPlatformRoles } from '@shared/db/bootstrap.js';
import { startBatchPoller } from './poller/batchPoller.js';
import { getConnectionPool, ConnectionPool } from '@shared/db/db-pool.js';
import { getAdapter } from '@shared/db/adapters/index.js';
import { loadEnterpriseBackendPlugin } from './enterprise/loadEnterpriseBackendPlugin.js';
const app = createApp({ registerBaseRoutes: false, registerFinalMiddleware: false });

const enterprisePlugin = await loadEnterpriseBackendPlugin();
app.locals.enterprisePluginLoaded = Boolean(
  enterprisePlugin && (enterprisePlugin.registerRoutes || enterprisePlugin.migrateEnterpriseDatabase)
);

try {
  // Pass database-agnostic connection pool to enterprise plugin
  await enterprisePlugin.registerRoutes?.(app as any, {
    connectionPool: getConnectionPool(),
    config,
  } as any);
} catch (error) {
  console.error('Failed to register enterprise routes:', error);
  throw error;
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
      const adapter = getAdapter();
      const createSchemaSQL = adapter.getCreateSchemaSQL(schema);
      await getConnectionPool().query(createSchemaSQL);
    }

    // Run enterprise migrations
    await enterprisePlugin.migrateEnterpriseDatabase({
      connectionPool: getConnectionPool(),
      config,
    } as any);
  } catch (error) {
    console.error('Failed to run enterprise migrations:', error);
    throw error;
  }
}

// Bootstrap admin account on first run
await bootstrapAdmin({ allowPlatformAdmin: !app.locals.enterprisePluginLoaded });
await backfillMissingPlatformRoles();

await backfillKnownUserProfiles({ allowPlatformAdmin: !app.locals.enterprisePluginLoaded });

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
