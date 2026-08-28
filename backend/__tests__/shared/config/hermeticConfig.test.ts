import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dotenvConfig = vi.hoisted(() => vi.fn());
const originalDatabaseType = process.env.DATABASE_TYPE;
const originalTenancyMode = process.env.EG_TENANCY_MODE;
const originalTenantRlsEnforced = process.env.EG_TENANT_RLS_ENFORCED;
const originalTenantSecretBrokerUrl = process.env.EG_TENANT_SECRET_BROKER_URL;
const originalTenantSecretBrokerTokenRef = process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF;
const originalTenantSecretBrokerRequired = process.env.EG_TENANT_SECRET_BROKER_REQUIRED;
const runtimeEnvironmentNames = [
  'EG_RUNTIME_ROLE',
  'EG_DATABASE_STARTUP_MODE',
] as const;
const originalRuntimeEnvironment = new Map(
  runtimeEnvironmentNames.map((name) => [name, process.env[name]]),
);
const eligibilityEnvironmentNames = [
  'EG_TENANT_APP_ELIGIBILITY_REQUIRED',
  'EG_TENANT_APP_ELIGIBILITY_JWKS_JSON',
  'EG_TENANT_APP_ELIGIBILITY_ISSUER',
  'EG_TENANT_APP_ELIGIBILITY_AUDIENCE',
  'EG_TENANT_APP_ELIGIBILITY_CLOCK_SKEW_SECONDS',
  'EG_TENANT_APP_ELIGIBILITY_MAX_LIFETIME_SECONDS',
] as const;
const originalEligibilityEnvironment = new Map(
  eligibilityEnvironmentNames.map((name) => [name, process.env[name]]),
);

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
    for (const name of eligibilityEnvironmentNames) delete process.env[name];
    for (const name of runtimeEnvironmentNames) delete process.env[name];
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
    for (const name of eligibilityEnvironmentNames) {
      const value = originalEligibilityEnvironment.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const name of runtimeEnvironmentNames) {
      const value = originalRuntimeEnvironment.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
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

  it('preserves combined runtime and migration apply defaults', async () => {
    const { config } = await import('@enterpriseglue/shared/config/index.js');
    expect(config.runtimeRole).toBe('all');
    expect(config.databaseStartupMode).toBe('apply');
  });

  it('accepts split worker runtime with read-only migration verification', async () => {
    process.env.EG_RUNTIME_ROLE = 'worker';
    process.env.EG_DATABASE_STARTUP_MODE = 'verify';
    const { config } = await import('@enterpriseglue/shared/config/index.js');
    expect(config.runtimeRole).toBe('worker');
    expect(config.databaseStartupMode).toBe('verify');
  });

  it('rejects unknown runtime and database startup modes', async () => {
    process.env.EG_RUNTIME_ROLE = 'frontend';
    process.env.EG_DATABASE_STARTUP_MODE = 'synchronize';
    await expect(import('@enterpriseglue/shared/config/index.js')).rejects.toThrow();
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

  it('fails closed when signed tenant application eligibility is incomplete', async () => {
    process.env.EG_TENANT_APP_ELIGIBILITY_REQUIRED = 'true';
    process.env.EG_TENANT_APP_ELIGIBILITY_ISSUER = 'https://control.example';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('Signed tenant application eligibility requires');
  });

  it('rejects private or non-ES256 eligibility keys', async () => {
    process.env.EG_TENANT_APP_ELIGIBILITY_JWKS_JSON = JSON.stringify({
      keys: [{
        kid: 'private-key',
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        use: 'sig',
        x: 'invalid',
        y: 'invalid',
        d: 'must-not-be-configured',
      }],
    });
    process.env.EG_TENANT_APP_ELIGIBILITY_ISSUER = 'https://control.example';
    process.env.EG_TENANT_APP_ELIGIBILITY_AUDIENCE = 'shard';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('must contain unique public ES256 keys with kid');
  });
});
