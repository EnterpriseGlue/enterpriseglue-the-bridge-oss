import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dotenvConfig = vi.hoisted(() => vi.fn());
const originalDatabaseType = process.env.DATABASE_TYPE;
const originalTenancyMode = process.env.EG_TENANCY_MODE;
const originalTenantRlsEnforced = process.env.EG_TENANT_RLS_ENFORCED;
const originalTenantSecretBrokerUrl = process.env.EG_TENANT_SECRET_BROKER_URL;
const originalTenantSecretBrokerTokenRef = process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF;
const originalTenantSecretBrokerRequired = process.env.EG_TENANT_SECRET_BROKER_REQUIRED;

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
    delete process.env.EG_TENANT_SECRET_BROKER_URL;
    delete process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF;
    delete process.env.EG_TENANT_SECRET_BROKER_REQUIRED;
  });

  afterEach(() => {
    if (originalDatabaseType === undefined) delete process.env.DATABASE_TYPE;
    else process.env.DATABASE_TYPE = originalDatabaseType;
    if (originalTenancyMode === undefined) delete process.env.EG_TENANCY_MODE;
    else process.env.EG_TENANCY_MODE = originalTenancyMode;
    if (originalTenantRlsEnforced === undefined) delete process.env.EG_TENANT_RLS_ENFORCED;
    else process.env.EG_TENANT_RLS_ENFORCED = originalTenantRlsEnforced;
    if (originalTenantSecretBrokerUrl === undefined) delete process.env.EG_TENANT_SECRET_BROKER_URL;
    else process.env.EG_TENANT_SECRET_BROKER_URL = originalTenantSecretBrokerUrl;
    if (originalTenantSecretBrokerTokenRef === undefined) delete process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF;
    else process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF = originalTenantSecretBrokerTokenRef;
    if (originalTenantSecretBrokerRequired === undefined) delete process.env.EG_TENANT_SECRET_BROKER_REQUIRED;
    else process.env.EG_TENANT_SECRET_BROKER_REQUIRED = originalTenantSecretBrokerRequired;
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

  it('rejects a non-loopback broker endpoint without HTTPS', async () => {
    process.env.EG_TENANT_SECRET_BROKER_URL = 'http://broker.internal.example';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_TENANT_SECRET_BROKER_URL must use HTTPS');
  });

  it('fails closed when the broker is required without both settings', async () => {
    process.env.EG_TENANT_SECRET_BROKER_REQUIRED = 'true';
    process.env.EG_TENANT_SECRET_BROKER_URL = 'https://broker.internal.example';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('requires EG_TENANT_SECRET_BROKER_URL and EG_TENANT_SECRET_BROKER_TOKEN_REF');
  });

  it('rejects recursive broker authentication references', async () => {
    process.env.EG_TENANT_SECRET_BROKER_URL = 'https://broker.internal.example';
    process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF = 'ref:tenant-secret://v1/tenant-alpha/oidc.client_secret/token';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_TENANT_SECRET_BROKER_TOKEN_REF cannot use a tenant-secret reference');
  });
});
