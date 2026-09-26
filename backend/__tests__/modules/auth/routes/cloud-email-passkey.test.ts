import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import cloudEmailPasskeyRoute from '../../../../../packages/backend-host/src/modules/auth/routes/cloud-email-passkey.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { sendVerificationEmail } from '@enterpriseglue/shared/services/email/auth.js';
import { sendEmailWithConfig } from '@enterpriseglue/shared/services/email/config.js';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '../../../../../packages/backend-host/src/modules/auth/routes/cloud-passkey-webauthn.js';
import { authSessionService } from '@enterpriseglue/shared/services/AuthSessionService.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { CloudEmailSignup } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudEmailSignup.js';
import { CloudPasskey } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudPasskey.js';
import { CloudPasskeyChallenge } from '@enterpriseglue/shared/infrastructure/persistence/entities/CloudPasskeyChallenge.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { mockCloudPasskeyCredential as credential } from '../../../fixtures/cloudPasskeyCredential.js';

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
vi.mock('../../../../../packages/backend-host/src/modules/auth/routes/cloud-passkey-webauthn.js', () => ({
  generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(), verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@enterpriseglue/shared/services/AuthSessionService.js', () => ({
  authSessionService: { issue: vi.fn() },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({
  authzGroupService: { ensureAuthenticatedUserMembershipWithManager: vi.fn() },
}));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  AuditActions: { LOGIN_SUCCESS: 'login.success' }, logAudit: vi.fn(),
}));

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Cloud email-and-passkey signup', () => {
  const pending = new Map<string, CloudEmailSignup>();
  const users = new Map<string, User>();
  const credentials: Array<Partial<CloudPasskey>> = [];
  const challenges: Array<Partial<CloudPasskeyChallenge>> = [];
  const pendingRepo = {
    findOneBy: vi.fn(async (where: Record<string, unknown>) => [...pending.values()].find((record) =>
      (where.emailHash === undefined || record.emailHash === where.emailHash)
      && (where.tokenHash === undefined || record.tokenHash === where.tokenHash)) || null),
    insert: vi.fn(async (value: CloudEmailSignup) => { pending.set(value.id, { ...value }); return { affected: 1 }; }),
    update: vi.fn(async (where: { id: string }, value: Partial<CloudEmailSignup>) => {
      const old = pending.get(where.id);
      if (old) pending.set(where.id, { ...old, ...value });
      return { affected: old ? 1 : 0 };
    }),
    delete: vi.fn(async (where: { id: string; tokenHash: string; challenge: string }) => {
      const old = pending.get(where.id);
      if (!old || old.tokenHash !== where.tokenHash || old.challenge !== where.challenge) return { affected: 0 };
      pending.delete(where.id);
      return { affected: 1 };
    }),
  };
  const userRepo = {
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn(async () => [...users.values()][0] || null),
    })),
    insert: vi.fn(async (value: User) => { users.set(value.id, value); return { affected: 1 }; }),
    findOneBy: vi.fn(async (where: { id: string }) => users.get(where.id) || null),
    findOneByOrFail: vi.fn(async (where: { id: string }) => users.get(where.id)!),
    update: vi.fn(async (where: { id: string }, value: Partial<User>) => {
      const old = users.get(where.id);
      if (old) users.set(where.id, { ...old, ...value });
      return { affected: old ? 1 : 0 };
    }),
  };
  const passkeyRepo = {
    insert: vi.fn(async (value: Partial<CloudPasskey>) => { credentials.push(value); return { affected: 1 }; }),
    findOneBy: vi.fn(async (where: { credentialIdHash: string }) => credentials.find((record) => record.credentialIdHash === where.credentialIdHash) || null),
    update: vi.fn(async (where: { id: string; counter: number }, value: Partial<CloudPasskey>) => {
      const old = credentials.find((record) => record.id === where.id && record.counter === where.counter);
      if (old) Object.assign(old, value);
      return { affected: old ? 1 : 0 };
    }),
  };
  const challengeRepo = {
    insert: vi.fn(async (value: Partial<CloudPasskeyChallenge>) => { challenges.push(value); return { affected: 1 }; }),
    findOneBy: vi.fn(async (where: { tokenHash: string }) => challenges.find((record) => record.tokenHash === where.tokenHash && Number(record.expiresAt) > Date.now()) || null),
    delete: vi.fn(async (where: { id: string; tokenHash: string }) => {
      const index = challenges.findIndex((record) => record.id === where.id && record.tokenHash === where.tokenHash);
      if (index < 0) return { affected: 0 };
      challenges.splice(index, 1);
      return { affected: 1 };
    }),
  };
  const manager = { getRepository: (entity: unknown) => entity === CloudEmailSignup ? pendingRepo
    : entity === User ? userRepo : entity === CloudPasskey ? passkeyRepo : challengeRepo };
  const dataSource = { ...manager, transaction: async (callback: (manager: typeof manager) => Promise<unknown>) => callback(manager) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const signupCookie = req.headers.cookie?.match(/cloud_email_signup_proof=([^;]+)/)?.[1];
    const loginCookie = req.headers.cookie?.match(/cloud_passkey_login_proof=([^;]+)/)?.[1];
    req.cookies = { ...(signupCookie ? { cloud_email_signup_proof: signupCookie } : {}),
      ...(loginCookie ? { cloud_passkey_login_proof: loginCookie } : {}) };
    next();
  });
  app.use(cloudEmailPasskeyRoute);
  app.use(errorHandler);

  beforeEach(() => {
    vi.clearAllMocks();
    pending.clear(); users.clear(); credentials.length = 0; challenges.length = 0;
    Object.assign(config, { tenancyMode: 'pooled', tenancyCloudRequired: true, cloudAccountIdentityEnabled: true });
    vi.mocked(getDataSource).mockResolvedValue(dataSource as never);
    vi.mocked(sendVerificationEmail).mockResolvedValue({ success: true });
    vi.mocked(sendEmailWithConfig).mockResolvedValue({ success: true });
    vi.mocked(generateRegistrationOptions).mockResolvedValue({ challenge: 'test-challenge' } as never);
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({ challenge: 'test-login-challenge' } as never);
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({ verified: true,
      registrationInfo: { credential: { id: 'registered-credential', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } } as never);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } } as never);
    vi.mocked(authSessionService.issue).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 300, tenantId: null });
    vi.mocked(authzGroupService.ensureAuthenticatedUserMembershipWithManager).mockResolvedValue({ id: 'baseline', created: true });
  });

  it('fails closed outside managed Cloud mode', async () => {
    config.cloudAccountIdentityEnabled = false;
    const response = await request(app).post('/api/auth/cloud-signup/email/request').send({ email: 'new@example.com' });
    expect(response.status).toBe(404);
    expect(getDataSource).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends existing-account guidance without creating a pending signup or linking identities', async () => {
    users.set('existing', { id: 'existing', email: 'member@example.com' } as User);
    const response = await request(app).post('/api/auth/cloud-signup/email/request').send({ email: 'MEMBER@example.com' });
    expect(response.status).toBe(202);
    expect(sendEmailWithConfig).toHaveBeenCalledOnce();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(pendingRepo.insert).not.toHaveBeenCalled();
    expect(credentials).toHaveLength(0);
  });

  it('does not create an account until the email proof and passkey registration both succeed', async () => {
    const requested = await request(app).post('/api/auth/cloud-signup/email/request').send({ email: 'New@Example.com' });
    expect(requested.status).toBe(202);
    expect(users.size).toBe(0);
    expect(pending.size).toBe(1);
    const link = vi.mocked(sendVerificationEmail).mock.calls[0]![0].verificationUrl;
    const token = new URL(link).searchParams.get('token')!;
    const verified = await request(app).get(`/api/auth/cloud-signup/email/verify?token=${token}`);
    expect(verified.status).toBe(302);
    expect(verified.headers.location).toBe('https://app.staging.enterpriseglue.ai/signup/email/passkey');
    expect(users.size).toBe(0);
    const browserCookie = `cloud_email_signup_proof=${token}`;
    const options = await request(app).post('/api/auth/cloud-signup/email/passkey/options').set('Cookie', browserCookie).send({});
    expect(options.status).toBe(200);
    expect(options.body.challenge).toBe('test-challenge');
    const completed = await request(app).post('/api/auth/cloud-signup/email/passkey/complete').set('Cookie', browserCookie).send(credential);
    expect(completed.status, JSON.stringify({ body: completed.body, verifyCalls: vi.mocked(verifyRegistrationResponse).mock.calls.length,
      verifyResult: vi.mocked(verifyRegistrationResponse).mock.results[0] })).toBe(201);
    expect(users.size).toBe(1);
    expect([...users.values()][0]).toMatchObject({ email: 'new@example.com', authProvider: 'passkey', isEmailVerified: true, platformRole: 'user' });
    expect(credentials).toHaveLength(1);
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledOnce();
    expect(authSessionService.issue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionClass: 'cloud_account', authenticationMethod: 'passkey', mfaVerified: true,
    }));
    expect(pending.size).toBe(0);
    const replay = await request(app).post('/api/auth/cloud-signup/email/passkey/complete').set('Cookie', browserCookie).send(credential);
    expect(replay.status).toBe(401);
    expect(users.size).toBe(1);
  });

  it('rejects an expired proof and never reaches passkey verification', async () => {
    const token = 'a'.repeat(43);
    pending.set('old', { id: 'old', email: 'new@example.com', emailHash: hash('new@example.com'), tokenHash: hash(token),
      expiresAt: Date.now() - 1, challenge: 'test-challenge', challengeExpiresAt: Date.now() + 60_000 } as CloudEmailSignup);
    const result = await request(app).post('/api/auth/cloud-signup/email/passkey/complete')
      .set('Cookie', `cloud_email_signup_proof=${token}`).send(credential);
    expect(result.status).toBe(401);
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
    expect(users.size).toBe(0);
  });

  it('requires the browser-bound challenge and consumes it only once for passkey sign-in', async () => {
    users.set('user-1', { id: 'user-1', email: 'new@example.com', isActive: true, isEmailVerified: true } as User);
    credentials.push({ id: 'passkey-1', userId: 'user-1', credentialId: credential.id,
      credentialIdHash: hash(credential.id), publicKey: Buffer.from([1, 2, 3]).toString('base64url'),
      counter: 0, transportsJson: '["internal"]', revokedAt: null });
    const assertion = { ...credential, response: { userHandle: Buffer.from('user-1').toString('base64url') } };
    const noChallenge = await request(app).post('/api/auth/cloud-passkey/complete').send(assertion);
    expect(noChallenge.status).toBe(401);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    const options = await request(app).post('/api/auth/cloud-passkey/options').send({});
    expect(options.status).toBe(200);
    const token = options.headers['set-cookie']?.[0]?.match(/cloud_passkey_login_proof=([^;]+)/)?.[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const browserCookie = `cloud_passkey_login_proof=${token}`;
    const completed = await request(app).post('/api/auth/cloud-passkey/complete').set('Cookie', browserCookie).send(assertion);
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(challenges).toHaveLength(0);
    expect(credentials[0]?.counter).toBe(1);
    expect(authSessionService.issue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sessionClass: 'cloud_account', authenticationMethod: 'passkey', mfaVerified: true,
    }));
    const replay = await request(app).post('/api/auth/cloud-passkey/complete').set('Cookie', browserCookie).send(assertion);
    expect(replay.status).toBe(401);
    expect(authSessionService.issue).toHaveBeenCalledOnce();
  });

  it('rejects a passkey assertion whose user handle is not the stored account', async () => {
    users.set('user-1', { id: 'user-1', email: 'new@example.com', isActive: true, isEmailVerified: true } as User);
    credentials.push({ id: 'passkey-1', userId: 'user-1', credentialId: credential.id,
      credentialIdHash: hash(credential.id), publicKey: Buffer.from([1, 2, 3]).toString('base64url'),
      counter: 0, transportsJson: '["internal"]', revokedAt: null });
    const options = await request(app).post('/api/auth/cloud-passkey/options').send({});
    const token = options.headers['set-cookie']?.[0]?.match(/cloud_passkey_login_proof=([^;]+)/)?.[1];
    const assertion = { ...credential, response: { userHandle: Buffer.from('other-user').toString('base64url') } };
    const response = await request(app).post('/api/auth/cloud-passkey/complete')
      .set('Cookie', `cloud_passkey_login_proof=${token}`).send(assertion);
    expect(response.status).toBe(401);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    expect(authSessionService.issue).not.toHaveBeenCalled();
    expect(challenges).toHaveLength(1);
  });
});
