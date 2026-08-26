import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dotenvConfig = vi.hoisted(() => vi.fn());
const originalDatabaseType = process.env.DATABASE_TYPE;
const originalTenancyMode = process.env.EG_TENANCY_MODE;
const originalTenantRlsEnforced = process.env.EG_TENANT_RLS_ENFORCED;

vi.mock('dotenv', () => ({
  default: { config: dotenvConfig },
  config: dotenvConfig,
}));

describe('hermetic test configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    dotenvConfig.mockClear();
    process.env.NODE_ENV = 'test';
    process.env.EG_LOAD_ENV_IN_TESTS = 'false';
  });

  afterEach(() => {
    if (originalDatabaseType === undefined) delete process.env.DATABASE_TYPE;
    else process.env.DATABASE_TYPE = originalDatabaseType;
    if (originalTenancyMode === undefined) delete process.env.EG_TENANCY_MODE;
    else process.env.EG_TENANCY_MODE = originalTenancyMode;
    if (originalTenantRlsEnforced === undefined) delete process.env.EG_TENANT_RLS_ENFORCED;
    else process.env.EG_TENANT_RLS_ENFORCED = originalTenantRlsEnforced;
  });

  it('does not read developer environment files in the unit-test lane', async () => {
    await import('@enterpriseglue/shared/config/index.js');
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it('allows an explicit protocol-rehearsal opt-in', async () => {
    process.env.EG_LOAD_ENV_IN_TESTS = 'true';
    await import('@enterpriseglue/shared/config/index.js');
    expect(dotenvConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects pooled tenancy on a non-PostgreSQL database', async () => {
    process.env.EG_TENANCY_MODE = 'pooled';
    process.env.EG_TENANT_RLS_ENFORCED = 'true';
    process.env.DATABASE_TYPE = 'mysql';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_TENANCY_MODE=pooled requires DATABASE_TYPE=postgres.');
  });

  it('rejects pooled tenancy unless RLS enforcement is acknowledged', async () => {
    process.env.EG_TENANCY_MODE = 'pooled';
    process.env.EG_TENANT_RLS_ENFORCED = 'false';
    process.env.DATABASE_TYPE = 'postgres';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_TENANCY_MODE=pooled requires EG_TENANT_RLS_ENFORCED=true');
  });
});
