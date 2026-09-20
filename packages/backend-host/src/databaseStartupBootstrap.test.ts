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
  it('keeps schema and seed writers disabled while honoring config bootstrap authority in verify mode', async () => {
    const bootstrapOperations = operations();

    await expect(runDatabaseStartupBootstraps('verify', bootstrapOperations)).resolves.toBe(false);

    expect(bootstrapOperations.applyConfigBundle).toHaveBeenCalledOnce();
    expect(bootstrapOperations.migrateEnterpriseDatabase).not.toHaveBeenCalled();
    expect(bootstrapOperations.bootstrapAdmin).not.toHaveBeenCalled();
    expect(bootstrapOperations.bootstrapDefaultEmailConfig).not.toHaveBeenCalled();
    expect(bootstrapOperations.seedGitProviders).not.toHaveBeenCalled();
    expect(bootstrapOperations.seedEnvironmentTags).not.toHaveBeenCalled();
  });

  it('fails verify-mode startup when the independently authorized config bootstrap fails', async () => {
    const bootstrapOperations = operations();
    bootstrapOperations.applyConfigBundle.mockRejectedValue(new Error('config bootstrap failed'));

    await expect(runDatabaseStartupBootstraps('verify', bootstrapOperations)).rejects.toThrow('config bootstrap failed');

    expect(bootstrapOperations.applyConfigBundle).toHaveBeenCalledOnce();
    expect(bootstrapOperations.migrateEnterpriseDatabase).not.toHaveBeenCalled();
    expect(bootstrapOperations.bootstrapAdmin).not.toHaveBeenCalled();
    expect(bootstrapOperations.bootstrapDefaultEmailConfig).not.toHaveBeenCalled();
    expect(bootstrapOperations.seedGitProviders).not.toHaveBeenCalled();
    expect(bootstrapOperations.seedEnvironmentTags).not.toHaveBeenCalled();
  });

  it('preserves application-owned bootstrap work in apply mode', async () => {
    const bootstrapOperations = operations();

    await expect(runDatabaseStartupBootstraps('apply', bootstrapOperations)).resolves.toBe(true);

    for (const operation of Object.values(bootstrapOperations)) {
      expect(operation).toHaveBeenCalledOnce();
    }
  });
});
