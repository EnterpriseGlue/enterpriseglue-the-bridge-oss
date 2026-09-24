import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import type { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import cloudEmailPasskeyRoute from '../../../packages/backend-host/src/modules/auth/routes/cloud-email-passkey.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { sendVerificationEmail } from '@enterpriseglue/shared/services/email/auth.js';
import { sendEmailWithConfig } from '@enterpriseglue/shared/services/email/config.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '../../../packages/backend-host/src/modules/auth/routes/cloud-passkey-webauthn.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { CloudEmailSignup } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudEmailSignup.js';
import { CloudPasskey } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudPasskey.js';
import { CloudPasskeyChallenge } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudPasskeyChallenge.js';
import { mockCloudPasskeyCredential as credential } from '../../__tests__/fixtures/cloudPasskeyCredential.js';

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  identityFlowLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: { tenancyMode: 'pooled', tenancyCloudRequired: true, cloudAccountIdentityEnabled: true,
    frontendUrl: 'https://app.staging.enterpriseglue.ai', jwtRefreshTokenExpires: 604800 },
  shouldUseSecureCookies: () => true,
}));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/email/auth.js', () => ({ sendVerificationEmail: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/email/config.js', () => ({ sendEmailWithConfig: vi.fn() }));
vi.mock('../../../packages/backend-host/src/modules/auth/routes/cloud-passkey-webauthn.js', () => ({
  generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(), verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@enterpriseglue/shared/services/AuthSessionService.js', () => ({ authSessionService: { issue: vi.fn() } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({
  authzGroupService: { ensureAuthenticatedUserMembershipWithManager: vi.fn() },
}));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  AuditActions: { LOGIN_SUCCESS: 'login.success' }, logAudit: vi.fn(),
}));

const env = (name: string, fallback: string) =>
  process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const schema = `cloud_passkey_${Date.now()}`;
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const entities = [User, CloudEmailSignup, CloudPasskey, CloudPasskeyChallenge];
const originalSchemas: Array<{ table: { schema?: string }; schema?: string }> = [];
let pool: Pool;
let dataSource: DataSource;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((entry) => entry.trim().split('=')));
  next();
});
app.use(cloudEmailPasskeyRoute);
app.use(errorHandler);

describe('Cloud email/passkey lifecycle on disposable PostgreSQL', () => {
  beforeAll(async () => {
    if (process.env.SESSION_RACE_DISPOSABLE_POSTGRES !== 'true' || !process.env.MIGRATION_TEST_POSTGRES_CONTAINER) {
      throw new Error('Cloud passkey PostgreSQL integration requires the owned disposable fixture');
    }
    const pgModule = await import('pg');
    const PoolConstructor = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;
    pool = new PoolConstructor({
      host: env('POSTGRES_HOST', 'localhost'), port: Number(env('POSTGRES_PORT', '5432')),
      user: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres'),
      database: env('POSTGRES_DATABASE', 'postgres'),
      ssl: env('POSTGRES_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
    });
    await pool.query(`CREATE SCHEMA ${quote(schema)}`);
    for (const entity of entities) {
      const table = getMetadataArgsStorage().tables.find((entry) => entry.target === entity);
      if (!table) throw new Error(`Missing TypeORM metadata for ${entity.name}`);
      originalSchemas.push({ table, schema: table.schema });
      table.schema = schema;
    }
    dataSource = await new DataSource({
      type: 'postgres', host: env('POSTGRES_HOST', 'localhost'), port: Number(env('POSTGRES_PORT', '5432')),
      username: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres'),
      database: env('POSTGRES_DATABASE', 'postgres'), schema, synchronize: true, entities,
      ssl: env('POSTGRES_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
    }).initialize();
    vi.mocked(getDataSource).mockResolvedValue(dataSource);
    vi.mocked(sendVerificationEmail).mockResolvedValue({ success: true });
    vi.mocked(sendEmailWithConfig).mockResolvedValue({ success: true });
    vi.mocked(generateRegistrationOptions).mockResolvedValue({ challenge: 'pg-registration-challenge' } as never);
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({ challenge: 'pg-login-challenge' } as never);
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({ verified: true, registrationInfo: {
      credential: { id: credential.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
    } } as never);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } } as never);
    vi.mocked(authzGroupService.ensureAuthenticatedUserMembershipWithManager).mockResolvedValue({ id: 'baseline', created: true });
    vi.mocked(authSessionService.issue).mockResolvedValue({
      accessToken: 'access', refreshToken: 'refresh', expiresIn: 300, tenantId: null,
    });
  }, 60_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    for (const { table, schema: originalSchema } of originalSchemas) table.schema = originalSchema;
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
      await pool.end();
    }
  }, 60_000);

  it('commits a verified account and sign-in atomically, without email-only merging or replay', async () => {
    const requested = await request(app).post('/api/auth/cloud-signup/email/request').send({ email: 'New@Example.com' });
    expect(requested.status, JSON.stringify(requested.body)).toBe(202);
    expect(await dataSource.getRepository(User).count()).toBe(0);
    const link = vi.mocked(sendVerificationEmail).mock.calls[0]![0].verificationUrl;
    const token = new URL(link).searchParams.get('token')!;
    const verified = await request(app).get(`/api/auth/cloud-signup/email/verify?token=${token}`);
    expect(verified.status).toBe(302);
    const signupCookie = `cloud_email_signup_proof=${token}`;
    const options = await request(app).post('/api/auth/cloud-signup/email/passkey/options').set('Cookie', signupCookie).send({});
    expect(options.status, JSON.stringify(options.body)).toBe(200);

    vi.mocked(authSessionService.issue).mockRejectedValueOnce(new Error('injected session persistence failure'));
    const failed = await request(app).post('/api/auth/cloud-signup/email/passkey/complete')
      .set('Cookie', signupCookie).send(credential);
    expect(failed.status).toBe(500);
    expect(await dataSource.getRepository(User).count()).toBe(0);
    expect(await dataSource.getRepository(CloudPasskey).count()).toBe(0);
    expect(await dataSource.getRepository(CloudEmailSignup).count()).toBe(1);

    const completed = await request(app).post('/api/auth/cloud-signup/email/passkey/complete')
      .set('Cookie', signupCookie).send(credential);
    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    const users = await dataSource.getRepository(User).find();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: 'new@example.com', authProvider: 'passkey', isEmailVerified: true });
    expect(await dataSource.getRepository(CloudPasskey).count()).toBe(1);
    expect(await dataSource.getRepository(CloudEmailSignup).count()).toBe(0);
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalled();

    const replay = await request(app).post('/api/auth/cloud-signup/email/passkey/complete')
      .set('Cookie', signupCookie).send(credential);
    expect(replay.status).toBe(401);
    const existing = await request(app).post('/api/auth/cloud-signup/email/request').send({ email: 'NEW@example.com' });
    expect(existing.status).toBe(202);
    expect(sendEmailWithConfig).toHaveBeenCalledOnce();
    expect(await dataSource.getRepository(User).count()).toBe(1);

    const loginOptions = await request(app).post('/api/auth/cloud-passkey/options').send({});
    expect(loginOptions.status, JSON.stringify(loginOptions.body)).toBe(200);
    const loginToken = loginOptions.headers['set-cookie']?.[0]?.match(/cloud_passkey_login_proof=([^;]+)/)?.[1];
    expect(loginToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const assertion = { ...credential, response: { userHandle: Buffer.from(users[0]!.id).toString('base64url') } };
    const signedIn = await request(app).post('/api/auth/cloud-passkey/complete')
      .set('Cookie', `cloud_passkey_login_proof=${loginToken}`).send(assertion);
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    expect(await dataSource.getRepository(CloudPasskeyChallenge).count()).toBe(0);
    expect(Number((await dataSource.getRepository(CloudPasskey).findOneByOrFail({ userId: users[0]!.id })).counter)).toBe(1);
    const loginReplay = await request(app).post('/api/auth/cloud-passkey/complete')
      .set('Cookie', `cloud_passkey_login_proof=${loginToken}`).send(assertion);
    expect(loginReplay.status).toBe(401);
    expect(await dataSource.getRepository(User).count()).toBe(1);
  }, 60_000);
});
