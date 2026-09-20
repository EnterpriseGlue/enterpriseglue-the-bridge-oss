export type DatabaseStartupMode = 'apply' | 'verify';

export interface DatabaseStartupBootstrapOperations {
  migrateEnterpriseDatabase?: () => Promise<unknown>;
  bootstrapAdmin: () => Promise<unknown>;
  bootstrapDefaultEmailConfig: () => Promise<unknown>;
  applyConfigBundle: () => Promise<unknown>;
  seedGitProviders: () => Promise<unknown>;
  seedEnvironmentTags: () => Promise<unknown>;
}

/**
 * Run application-owned schema and seed work only when the application
 * explicitly owns database initialization. Configuration-bundle bootstrap has
 * its own validate/apply authority and must run in both database startup modes;
 * otherwise a verify-mode release silently ignores an explicitly authorized
 * configuration apply.
 */
export async function runDatabaseStartupBootstraps(
  mode: DatabaseStartupMode,
  operations: DatabaseStartupBootstrapOperations,
) {
  if (mode === 'verify') {
    await operations.applyConfigBundle();
    return false;
  }

  await operations.migrateEnterpriseDatabase?.();
  await operations.bootstrapAdmin();
  await operations.bootstrapDefaultEmailConfig();
  await operations.applyConfigBundle();
  await operations.seedGitProviders();
  await operations.seedEnvironmentTags();
  return true;
}
