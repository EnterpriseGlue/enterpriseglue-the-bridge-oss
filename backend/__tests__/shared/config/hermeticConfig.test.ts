import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const dotenvConfig = vi.hoisted(() => vi.fn());
const originalDatabaseType = process.env.DATABASE_TYPE;
const originalTenancyMode = process.env.EG_TENANCY_MODE;
const originalTenantRlsEnforced = process.env.EG_TENANT_RLS_ENFORCED;
const originalTenantSecretBrokerUrl = process.env.EG_TENANT_SECRET_BROKER_URL;
const originalTenantSecretBrokerTokenRef = process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF;
const originalTenantSecretBrokerRequired = process.env.EG_TENANT_SECRET_BROKER_REQUIRED;
const runtimeEnvironmentNames = [
  'TENANCY_MODE',
  'EG_RUNTIME_ROLE',
  'EG_DATABASE_STARTUP_MODE',
  'EG_TENANT_PLACEMENT_RELEASE_ID',
  'EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH',
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
const cloudIdentityEnvironmentNames = [
  'EG_TENANCY_CLOUD_REQUIRED',
  'EG_CLOUD_ACCOUNT_IDENTITY_ENABLED',
  'EG_TENANT_PLACEMENT_V2_JWKS_JSON',
  'EG_TENANT_PLACEMENT_V2_ISSUER',
  'EG_TENANT_PLACEMENT_V2_AUDIENCE',
  'EG_TENANT_PLACEMENT_V2_SHARD_ID',
  'EG_TENANT_WORKLOAD_RECEIPT_PRIVATE_KEY',
  'EG_TENANT_WORKLOAD_RECEIPT_KEY_ID',
  'EG_TENANT_WORKLOAD_RECEIPT_ISSUER',
  'EG_TENANT_CLOUD_IDENTITY_AUDIENCE',
  'EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE',
] as const;
const originalCloudIdentityEnvironment = new Map(
  cloudIdentityEnvironmentNames.map((name) => [name, process.env[name]]),
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
    for (const name of cloudIdentityEnvironmentNames) delete process.env[name];
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
    for (const name of cloudIdentityEnvironmentNames) {
      const value = originalCloudIdentityEnvironment.get(name);
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

  it('binds a positive effect cohort epoch to an explicit release identity', async () => {
    process.env.EG_TENANT_PLACEMENT_RELEASE_ID = 'release-preview';
    process.env.EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH = '7';
    const { config } = await import('@enterpriseglue/shared/config/index.js');
    expect(config).toMatchObject({
      tenantPlacementReleaseId: 'release-preview',
      tenantReleaseEffectCohortEpoch: 7,
    });
  });

  it('rejects an effect cohort epoch without a release identity', async () => {
    process.env.EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH = '7';
    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH requires EG_TENANT_PLACEMENT_RELEASE_ID.');
  });

  it('rejects a managed pooled Cloud release identity without a cohort epoch', async () => {
    process.env.EG_TENANCY_MODE = 'pooled';
    process.env.EG_TENANCY_CLOUD_REQUIRED = 'true';
    process.env.EG_TENANT_RLS_ENFORCED = 'true';
    process.env.EG_TENANT_PLACEMENT_RELEASE_ID = `sha256:${'1'.repeat(64)}`;
    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('Managed pooled Cloud release awareness requires EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH.');
  });

  it('rejects an arbitrary managed release label instead of a verified candidate receipt digest', async () => {
    process.env.EG_TENANCY_MODE = 'pooled';
    process.env.TENANCY_MODE = 'single';
    process.env.EG_TENANCY_CLOUD_REQUIRED = 'true';
    process.env.EG_TENANT_RLS_ENFORCED = 'true';
    process.env.EG_TENANT_PLACEMENT_RELEASE_ID = 'release-preview';
    process.env.EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH = '7';
    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('sha256 digest of the verified signed candidate receipt');
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

  it('allows a cloud-required host to start before the platform identity audience is configured', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = pair.publicKey.export({ format: 'jwk' });
    const jwks = JSON.stringify({ keys: [{ ...jwk, kid: 'control-key-1', alg: 'ES256', use: 'sig' }] });
    process.env.DATABASE_TYPE = 'postgres';
    process.env.EG_TENANCY_MODE = 'pooled';
    process.env.EG_TENANT_RLS_ENFORCED = 'true';
    process.env.EG_TENANCY_CLOUD_REQUIRED = 'true';
    process.env.EG_TENANT_PLACEMENT_V2_JWKS_JSON = jwks;
    process.env.EG_TENANT_PLACEMENT_V2_ISSUER = 'https://control.example';
    process.env.EG_TENANT_PLACEMENT_V2_AUDIENCE = 'enterpriseglue-shard';
    process.env.EG_TENANT_PLACEMENT_V2_SHARD_ID = 'regional-shard-01';
    process.env.EG_TENANT_WORKLOAD_RECEIPT_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.EG_TENANT_WORKLOAD_RECEIPT_KEY_ID = 'regional-shard-01-receipt';
    process.env.EG_TENANT_WORKLOAD_RECEIPT_ISSUER = 'regional-shard-01';
    process.env.EG_TENANT_SECRET_BROKER_REQUIRED = 'true';
    process.env.EG_TENANT_SECRET_BROKER_URL = 'https://broker.internal.example';
    process.env.EG_TENANT_SECRET_BROKER_TOKEN_REF = 'env://EG_TENANT_SECRET_BROKER_TOKEN';
    process.env.EG_TENANT_APP_ELIGIBILITY_REQUIRED = 'true';
    process.env.EG_TENANT_APP_ELIGIBILITY_JWKS_JSON = jwks;
    process.env.EG_TENANT_APP_ELIGIBILITY_ISSUER = 'https://control.example';
    process.env.EG_TENANT_APP_ELIGIBILITY_AUDIENCE = 'enterpriseglue-shard';

    const module = await import('@enterpriseglue/shared/config/index.js');
    expect(module.config.tenancyCloudRequired).toBe(true);
    expect(module.config.platformCloudIdentityAudience).toBeUndefined();
  });

  it('rejects a platform identity audience shared with tenant assertions', async () => {
    process.env.EG_TENANT_CLOUD_IDENTITY_AUDIENCE = 'shared-control-plane';
    process.env.EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE = 'shared-control-plane';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE must differ from EG_TENANT_CLOUD_IDENTITY_AUDIENCE.');
  });

  it('rejects a platform identity issuer and audience collision', async () => {
    process.env.EG_TENANT_WORKLOAD_RECEIPT_ISSUER = 'regional-shard-01';
    process.env.EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE = 'regional-shard-01';

    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE must differ from EG_TENANT_WORKLOAD_RECEIPT_ISSUER.');
  });

  it('keeps Cloud account identity disabled by default', async () => {
    const { config } = await import('@enterpriseglue/shared/config/index.js');
    expect(config.cloudAccountIdentityEnabled).toBe(false);
  });

  it('admits Cloud account identity only for pooled managed Cloud tenancy', async () => {
    process.env.EG_CLOUD_ACCOUNT_IDENTITY_ENABLED = 'true';
    await expect(import('@enterpriseglue/shared/config/index.js'))
      .rejects.toThrow('EG_CLOUD_ACCOUNT_IDENTITY_ENABLED=true requires pooled managed Cloud tenancy.');
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
