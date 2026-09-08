import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { DataSource } from 'typeorm';

const database = vi.hoisted(() => ({ current: null as DataSource | null }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: async () => {
    if (!database.current) throw new Error('Integration database is not initialized');
    return database.current;
  },
}));

import { config } from '@enterpriseglue/shared/config/index.js';
import { PostgresAdapter } from '@enterpriseglue/shared/db/adapters/PostgresAdapter.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { requireAuth, requireCloudAccountOrTenantAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { normalizeUserJwtPayload, verifyToken } from '@enterpriseglue/shared/utils/jwt.js';
import refreshRouter from '@enterpriseglue/backend-host/modules/auth/routes/refresh.js';

const integrationEnv = (name: string, fallback: string): string =>
  process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const schema = `cloud_account_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const connection = {
  host: integrationEnv('POSTGRES_HOST', '127.0.0.1'),
  port: Number(integrationEnv('POSTGRES_PORT', '5432')),
  username: integrationEnv('POSTGRES_USER', 'postgres'),
  password: integrationEnv('POSTGRES_PASSWORD', 'postgres'),
  database: integrationEnv('POSTGRES_DATABASE', 'postgres'),
};
const original = {
  tenancyMode: config.tenancyMode,
  tenancyCloudRequired: config.tenancyCloudRequired,
  cloudAccountIdentityEnabled: config.cloudAccountIdentityEnabled,
  postgresSchema: config.postgresSchema,
};

const describePostgres = (process.env.DATABASE_TYPE || 'postgres') === 'postgres' ? describe : describe.skip;

describePostgres('managed Cloud account session with PostgreSQL', () => {
  const userId = 'cloud-account-user';
  const providerId = 'cloud-account-provider';
  const providerUpdatedAt = 1_800_000_000_000;

  beforeAll(async () => {
    Object.assign(config, {
      tenancyMode: 'pooled',
      tenancyCloudRequired: true,
      cloudAccountIdentityEnabled: true,
      postgresSchema: schema,
    });
    const pgModule = await import('pg');
    const pool = new (pgModule.default?.Pool || pgModule.Pool)({ ...connection, user: connection.username });
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await pool.end();
    }

    // Apply the production adapter's schema normalization, then keep this
    // focused database to the three entities exercised by session issuance.
    new PostgresAdapter();
    database.current = new DataSource({
      type: 'postgres',
      ...connection,
      schema,
      entities: [User, IdentityProvider, RefreshToken],
      synchronize: true,
      logging: false,
    });
    await database.current.initialize();
    await database.current.getRepository(User).insert({
      id: userId,
      email: 'cloud-account@example.test',
      authProvider: 'oidc',
      passwordHash: null,
      firstName: 'Cloud',
      lastName: 'Account',
      platformRole: 'user',
      isActive: true,
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      isEmailVerified: true,
      emailVerificationToken: null,
      emailVerificationTokenExpiry: null,
      createdAt: providerUpdatedAt,
      updatedAt: providerUpdatedAt,
      lastLoginAt: null,
      authSessionVersion: 0,
      createdByUserId: null,
    });
    await database.current.getRepository(IdentityProvider).insert({
      id: providerId,
      tenantId: null,
      key: 'identity.oidc.cloud-account-test',
      displayName: 'Cloud account test',
      organization: null,
      displayOrder: 0,
      isPreferred: true,
      preferredScopeIdentity: 'global:preferred',
      loginDomainsJson: '[]',
      providerKeyIdentity: 'platform:identity.oidc.cloud-account-test',
      protocol: 'oidc',
      isEnabled: true,
      authenticationMode: 'direct',
      directoryTenantId: null,
      configurationJson: '{}',
      syncJson: '{}',
      ownershipMode: 'manual',
      sourceRef: null,
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      createdAt: providerUpdatedAt,
      updatedAt: providerUpdatedAt,
    });
  });

  afterAll(async () => {
    if (database.current?.isInitialized) {
      const queryRunner = database.current.createQueryRunner();
      await queryRunner.connect();
      try { await queryRunner.dropSchema(schema, true, true); } finally { await queryRunner.release(); }
      await database.current.destroy();
    }
    database.current = null;
    Object.assign(config, original);
  });

  it('persists, authenticates, refreshes, and consumes only the explicit neutral class', async () => {
    const user = await database.current!.getRepository(User).findOneByOrFail({ id: userId });
    const session = await authSessionService.issue(user, {
      sessionClass: 'cloud_account',
      identityProviderId: providerId,
      identityProviderUpdatedAt: providerUpdatedAt,
      identityProviderProtocol: 'oidc',
      identityProviderAuthenticationMode: 'direct',
      identityProviderDirectoryTenantId: null,
      identityProviderConfigurationJson: '{}',
      authenticationMethod: 'oidc',
      federationSession: { subjectId: 'cloud-subject', sessionId: 'cloud-provider-session' },
    });
    const access = normalizeUserJwtPayload(verifyToken(session.accessToken));
    const persisted = await database.current!.getRepository(RefreshToken).findOneByOrFail({ id: access.sessionId! });
    expect(access).toMatchObject({ sessionClass: 'cloud_account' });
    expect(access).not.toHaveProperty('tenantId');
    expect(JSON.parse(persisted.deviceInfo!)).toMatchObject({ sessionClass: 'cloud_account' });

    const app = express();
    app.use(rateLimit({ windowMs: 60_000, limit: 50, standardHeaders: true, legacyHeaders: false }));
    app.use(express.json(), cookieParser());
    app.get('/account', requireCloudAccountOrTenantAuth, (_req, res) => res.json({ admitted: true }));
    app.get('/tenant', requireAuth, (_req, res) => res.json({ admitted: true }));
    app.use(refreshRouter);
    app.use(errorHandler);

    expect((await request(app).get('/account').set('Cookie', `accessToken=${session.accessToken}`)).status).toBe(200);
    expect((await request(app).get('/tenant').set('Cookie', `accessToken=${session.accessToken}`)).status).toBe(401);
    await database.current!.getRepository(RefreshToken).update({ id: persisted.id }, { revokedAt: Date.now() });
    expect((await request(app).get('/account').set('Cookie', `accessToken=${session.accessToken}`)).status).toBe(401);
    await database.current!.getRepository(RefreshToken).update({ id: persisted.id }, { revokedAt: null });
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const accessCookie = (refreshed.headers['set-cookie'] as unknown as string[])
      .find((cookie) => cookie.startsWith('accessToken='));
    expect(accessCookie).toBeTruthy();
    expect(verifyToken(accessCookie!.split(';')[0]!.slice('accessToken='.length))).toMatchObject({
      sessionClass: 'cloud_account', type: 'access',
    });

    const tenantSession = await authSessionService.switchTenant(user, {
      principal: access,
      refreshToken: session.refreshToken,
      tenantId: 'tenant-a',
      tenantSlug: 'alpha',
    });
    expect(verifyToken(tenantSession.accessToken)).toMatchObject({ tenantId: 'tenant-a', tenantSlug: 'alpha' });
    expect(verifyToken(tenantSession.accessToken).sessionClass).toBeUndefined();
    const rows = await database.current!.getRepository(RefreshToken).find({ order: { createdAt: 'ASC' } });
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1]!.deviceInfo!)).not.toHaveProperty('sessionClass');
  });
});
