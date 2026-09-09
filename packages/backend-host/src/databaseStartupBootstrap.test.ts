import { describe, expect, it, vi } from 'vitest';

import { runDatabaseStartupBootstraps } from './databaseStartupBootstrap.js';

function operations() {
  return {
    migrateEnterpriseDatabase: vi.fn().mockResolvedValue(undefined),
    bootstrapAdmin: vi.fn().mockResolvedValue(undefined),
    bootstrapDefaultEmailConfig: vi.fn().mockResolvedValue(undefined),
    applyConfigBundle: vi.fn().mockResolvedValue(undefined),
    seedGitProviders: vi.fn().mockResolvedValue(undefined),
    seedEnvironmentTags: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runDatabaseStartupBootstraps', () => {
  it('does not invoke any bootstrap writer for verify-only replicas', async () => {
    const bootstrapOperations = operations();

    await expect(runDatabaseStartupBootstraps('verify', bootstrapOperations)).resolves.toBe(false);

    for (const operation of Object.values(bootstrapOperations)) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it('preserves application-owned bootstrap work in apply mode', async () => {
    const bootstrapOperations = operations();

    await expect(runDatabaseStartupBootstraps('apply', bootstrapOperations)).resolves.toBe(true);

    for (const operation of Object.values(bootstrapOperations)) {
      expect(operation).toHaveBeenCalledOnce();
    }
  });
});
