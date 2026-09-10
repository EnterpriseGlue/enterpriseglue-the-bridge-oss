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
 * Run application-owned bootstrap work only when the application explicitly
 * owns schema/data initialization. Verify-mode replicas are read-only during
 * startup; a separately credentialed predecessor/owner job must prepare them.
 */
export async function runDatabaseStartupBootstraps(
  mode: DatabaseStartupMode,
  operations: DatabaseStartupBootstrapOperations,
) {
  if (mode === 'verify') return false;

  await operations.migrateEnterpriseDatabase?.();
  await operations.bootstrapAdmin();
  await operations.bootstrapDefaultEmailConfig();
  await operations.applyConfigBundle();
  await operations.seedGitProviders();
  await operations.seedEnvironmentTags();
  return true;
}
