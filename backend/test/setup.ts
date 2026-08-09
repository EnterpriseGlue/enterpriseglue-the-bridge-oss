process.env.NODE_ENV = 'test';
process.env.EG_LOAD_ENV_IN_TESTS = 'false';

// Deterministic, loopback-only defaults. Explicit test-runner values may
// override these before setup executes (for example a disposable Docker DB).
process.env.DATABASE_TYPE ??= 'postgres';
process.env.POSTGRES_HOST ??= '127.0.0.1';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USER ??= 'enterpriseglue_test';
process.env.POSTGRES_PASSWORD ??= 'enterpriseglue_test';
process.env.POSTGRES_DATABASE ??= 'enterpriseglue_test';
process.env.POSTGRES_SCHEMA ??= 'main';
process.env.JWT_SECRET ??= 'test-only-jwt-secret-000000000000000000000000';
process.env.ADMIN_PASSWORD ??= 'test-only-admin-password';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const databaseHostByType: Partial<Record<string, string | undefined>> = {
  postgres: process.env.POSTGRES_HOST,
  mysql: process.env.MYSQL_HOST,
  mssql: process.env.MSSQL_HOST,
  oracle: process.env.ORACLE_HOST,
};
const configuredTestHost = databaseHostByType[process.env.DATABASE_TYPE || 'postgres'];
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (
  configuredTestHost
  && !loopbackHosts.has(configuredTestHost)
  && process.env.EG_ALLOW_REMOTE_TEST_DATABASES !== 'true'
) {
  throw new Error(
    `Refusing to run the test lane against non-loopback ${process.env.DATABASE_TYPE} host ${configuredTestHost}. `
      + 'Set EG_ALLOW_REMOTE_TEST_DATABASES=true only for an intentional disposable test target.',
  );
}

import { vi } from 'vitest';

// Global mock for rate limiters - all limiters are no-ops in tests
vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
  identityFlowLimiter: vi.fn((_req: any, _res: any, next: any) => next()),
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  passwordResetVerifyLimiter: (_req: any, _res: any, next: any) => next(),
  fileOperationsLimiter: (_req: any, _res: any, next: any) => next(),
  projectCreateLimiter: (_req: any, _res: any, next: any) => next(),
  createUserLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
  auditLimiter: (_req: any, _res: any, next: any) => next(),
  notificationsLimiter: (_req: any, _res: any, next: any) => next(),
  dashboardLimiter: (_req: any, _res: any, next: any) => next(),
  missionControlLimiter: (_req: any, _res: any, next: any) => next(),
  configBundleLimiter: (_req: any, _res: any, next: any) => next(),
  identityAdminLimiter: (_req: any, _res: any, next: any) => next(),
  reconciliationLimiter: (_req: any, _res: any, next: any) => next(),
  engineRegistrationLimiter: (_req: any, _res: any, next: any) => next(),
  isNotificationsRequest: vi.fn().mockReturnValue(false),
  getClientIdentifier: vi.fn().mockReturnValue('test-client-id'),
}));
