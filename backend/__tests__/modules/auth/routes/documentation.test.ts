import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { generateAccessToken } from '@enterpriseglue/shared/utils/jwt.js';
import { verifyDocumentationIdentity } from '@enterpriseglue/shared/utils/documentation-identity.js';
import meRoute from '../../../../../packages/backend-host/src/modules/auth/routes/me.js';
import documentationRoute from '../../../../../packages/backend-host/src/modules/auth/routes/documentation.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/bpmn-engine-request-context.js', () => ({ updateBpmnEngineRequestContext: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn(), AuditActions: { USER_UPDATE: 'USER_UPDATE' } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', () => ({ getActivePlatformAdministratorUserIds: vi.fn().mockResolvedValue(new Set()) }));
vi.mock('@enterpriseglue/shared/services/capabilities.js', () => ({ buildUserCapabilities: vi.fn().mockResolvedValue({ canViewAdminMenu: false, canAccessAdminRoutes: false, canManageUsers: false, canViewAuditLogs: false, canManagePlatformSettings: false, canViewMissionControl: false, canManageTenants: false }) }));
const sessionId = '11111111-1111-4111-8111-111111111111';
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = 's'.repeat(43);
let row: RefreshToken;
let user: User;
let browserToken: string;
let app: express.Express;
let server: Server;
let updates: number;
beforeEach(async () => {
  Object.assign(config, { tenancyMode: 'pooled', tenancyCloudRequired: true, cloudAccountIdentityEnabled: true, frontendUrl: 'https://app.staging.enterpriseglue.ai', documentationOrigin: 'https://docs.enterpriseglue.ai', documentationGatewaySecret: 'gateway-secret-'.repeat(4) });
updates = 0; config.documentationWorkspacesJson = undefined;
  user = { id: 'reader', isActive: true, isEmailVerified: true, email: 'reader@example.test', authSessionVersion: 0, createdAt: Date.now() } as User;
  row = { id: sessionId, userId: user.id, tenantId: null, deviceInfo: JSON.stringify({ sessionClass: 'cloud_account' }), revokedAt: null, expiresAt: Date.now() + 600_000 } as RefreshToken;
  const repository = {
    findOneBy: vi.fn(async () => row.revokedAt === null ? { ...row } : null),
    update: vi.fn(async (criteria: { deviceInfo: string }, changes: Partial<RefreshToken>) => {
      if (criteria.deviceInfo !== row.deviceInfo || row.revokedAt !== null) return { affected: 0 };
      Object.assign(row, changes); updates++; return { affected: 1 };
    }),
  };
  vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
    if (entity === User) return { findOneBy: async () => user.isActive ? user : null, update: async (criteria: { id: string }, changes: Partial<User>) => { expect(criteria).toEqual({ id: user.id }); Object.assign(user, changes); return { affected: 1 }; } };
    if (entity === RefreshToken) return repository;
    // Any attempt to touch Tenant, placement or provisioning persistence fails this suite.
    throw new Error('Documentation must not access tenant persistence');
  } } as never);
  browserToken = generateAccessToken(user, { sessionId, authenticationMethod: 'oidc', sessionClass: 'cloud_account' });
  app = express(); app.use(express.json()); app.use(documentationRoute); app.use(meRoute);
  app.get('/tenant-api', apiLimiter, requireAuth, (_req, res) => res.json({ forbidden: true }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error instanceof Error ? error.message : 'error' }));
  // Keep one IPv4 listener for each test, including its concurrent requests.
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
async function grant() {
  return request(server).post('/api/auth/documentation/grant').set('Origin', config.frontendUrl).set('Authorization', `Bearer ${browserToken}`).send({ state, challenge });
}
async function exchange(code: string, proof = verifier) {
  return request(server).post('/api/auth/documentation/exchange').set('x-enterpriseglue-documentation-key', config.documentationGatewaySecret!).send({ code, verifier: proof });
}
async function check(token: string) {
  return request(server).get('/api/auth/documentation/session').set('x-enterpriseglue-documentation-key', config.documentationGatewaySecret!).set('Authorization', `Bearer ${token}`);
}
describe('documentation account boundary', () => {
  it('exposes only configured public origins for environment-correct entry and deployment preflight', async () => {
    const result = await request(server).get('/api/auth/documentation/configuration');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ documentationOrigin: config.documentationOrigin, accountOrigin: config.frontendUrl, workspaceContract: 'customer-documentation/v2' });
    expect(updates).toBe(0);
  });
  it('uses an existing verified account without accessing any tenant persistence', async () => {
    const created = await grant(); expect(created.status).toBe(200);
    const callback = new URL(created.body.callbackUrl); expect(callback.origin).toBe(config.documentationOrigin);
    const exchanged = await exchange(callback.searchParams.get('code')!); expect(exchanged.status).toBe(200);
    const claims = verifyDocumentationIdentity(exchanged.body.session, 'documentation_session');
    expect(claims.permission).toBe('documentation:read'); expect(claims.source.tenantId).toBeUndefined();
    expect((await check(exchanged.body.session)).status).toBe(200); expect(updates).toBe(2);
    expect(JSON.parse(row.deviceInfo!)).toEqual({ sessionClass: 'cloud_account', documentationSessions: [claims.jti] });
  });
  it('updates the same account profile without tenant access and rejects documentation credentials', async () => {
    const result = await request(server).patch('/api/auth/me').set('Authorization', `Bearer ${browserToken}`).send({ firstName: 'Alex', lastName: 'Reader', email: 'cannot-change@example.test' });
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ firstName: 'Alex', lastName: 'Reader', email: user.email, session: { tenant: { id: null } } });
    expect(user.firstName).toBe('Alex'); expect(user.lastName).toBe('Reader'); expect(user.email).toBe('reader@example.test');
    expect((await request(server).patch('/api/auth/me').set('Authorization', `Bearer ${browserToken}`).send({ firstName: 'x'.repeat(101) })).status).toBe(400);
    const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    const token = (await exchange(code)).body.session;
    for (const credential of [code, token]) expect((await request(server).patch('/api/auth/me').set('Authorization', `Bearer ${credential}`).send({ firstName: 'Unauthorized' })).status).toBe(401);
    row.revokedAt = Date.now();
    expect((await request(server).patch('/api/auth/me').set('Authorization', `Bearer ${browserToken}`).send({ firstName: 'Revoked' })).status).toBe(401);
    expect(user.firstName).toBe('Alex');
  });
  it('consumes a grant atomically once, including concurrent exchanges', async () => {
    const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    const results = await Promise.all([exchange(code), exchange(code)]);
    expect(results.map((value) => value.status).sort()).toEqual([200, 401]);
  });
  it('revokes documentation independently while preserving the source Cloud session, including ineligible accounts', async () => {
    const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    const token = (await exchange(code)).body.session;
    user.isEmailVerified = false;
    expect((await request(server).post('/api/auth/documentation/logout').set('x-enterpriseglue-documentation-key', config.documentationGatewaySecret!).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    user.isEmailVerified = true;
    expect((await check(token)).status).toBe(401);
    expect(row.revokedAt).toBeNull();
    expect(JSON.parse(row.deviceInfo!)).toEqual({ sessionClass: 'cloud_account', documentationSessions: [] });
    expect((await grant()).status).toBe(200);
  });
  it('rejects wrong browser proof, gateway credentials and cross-site grant creation', async () => {
    const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    expect((await exchange(code, 'x'.repeat(43))).status).toBe(401);
    expect((await request(server).post('/api/auth/documentation/exchange').send({ code, verifier })).status).toBe(401);
    expect((await request(server).post('/api/auth/documentation/grant').set('Origin', 'https://other.test').set('Authorization', `Bearer ${browserToken}`).send({ state, challenge })).status).toBe(403);
  });
  it('denies unverified/suspended accounts and retains exact source-session revocation', async () => {
    const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    const token = (await exchange(code)).body.session;
    user.mustResetPassword = true; expect((await check(token)).status).toBe(403);
    user.mustResetPassword = false; user.authSessionVersion = 1; expect((await check(token)).status).toBe(401);
    user.authSessionVersion = 0; user.isEmailVerified = false; expect((await check(token)).status).toBe(403);
    user.isEmailVerified = true; user.isActive = false; expect((await check(token)).status).toBe(401);
    user.isActive = true; row.revokedAt = Date.now(); expect((await check(token)).status).toBe(401);
  });
  it('documentation and grant tokens cannot authorize ordinary tenant or Cloud API routes', async () => {
    const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    const token = (await exchange(code)).body.session;
    expect((await request(server).get('/tenant-api').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await check(code)).status).toBe(401);
  });
  it('rejects an arbitrary redirect and disables the integration without configuration', async () => {
    expect((await request(server).post('/api/auth/documentation/grant').set('Origin', config.frontendUrl).set('Authorization', `Bearer ${browserToken}`).send({ state, challenge, returnTo: 'https://other.test' })).status).toBe(400);
    config.documentationOrigin = undefined; expect((await grant()).status).toBe(404);
  });
  it('expires grants and documentation tokens independently of the ordinary account credential', async () => {
    const first = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    try { expect((await exchange(first)).status).toBe(401); } finally { clock.mockRestore(); }
    const fresh = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    const token = (await exchange(fresh)).body.session;
    const expired = vi.spyOn(Date, 'now').mockReturnValue(now + 901_000);
    try { expect((await check(token)).status).toBe(401); } finally { expired.mockRestore(); }
    expect(row.revokedAt).toBeNull();
  });
  it('bounds active documentation credentials without granting tenant or application access', async () => {
    const tokens: string[] = [];
    for (let index = 0; index < 5; index++) {
      const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
      tokens.push((await exchange(code)).body.session);
    }
    expect(JSON.parse(row.deviceInfo!).documentationSessions).toHaveLength(4);
    expect((await check(tokens[0]!)).status).toBe(401);
    expect((await check(tokens[4]!)).status).toBe(200);
  });
});

describe('customer documentation entitlement boundary', () => {
  async function credential() {
    const code = new URL((await grant()).body.callbackUrl).searchParams.get('code')!;
    return (await exchange(code)).body.session as string;
  }
  const policy = () => JSON.stringify({ schemaVersion: 1, workspaces: [
    { id: 'alpha', name: 'Alpha customer', active: true, allowedEmailDomains: ['example.test'], readers: [{ userId: 'reader', expiresAt: Date.now() + 60_000 }] },
    { id: 'beta', name: 'Beta customer', active: true, allowedEmailDomains: ['other.test'], readers: [{ userId: 'other-reader', expiresAt: Date.now() + 60_000 }] },
  ] });
  async function scoped(token: string, workspace: string) {
    return request(server).get('/api/auth/documentation/session').query({ workspace }).set('x-enterpriseglue-documentation-key', config.documentationGatewaySecret!).set('Authorization', `Bearer ${token}`);
  }
  async function list(token: string) {
    return request(server).get('/api/auth/documentation/workspaces').set('x-enterpriseglue-documentation-key', config.documentationGatewaySecret!).set('Authorization', `Bearer ${token}`);
  }
  it('the operator policy template grants no customer access by default', async () => {
    config.documentationWorkspacesJson = readFileSync(new URL('../../../../../examples/documentation-workspaces/policy.example.json', import.meta.url), 'utf8');
    expect((await list(await credential())).body).toEqual({ workspaceContract: 'customer-documentation/v2', workspaces: [] });
  });
  it('returns only the explicitly granted customer and denies a sibling customer even with a valid general session', async () => {
    config.documentationWorkspacesJson = policy(); const token = await credential();
    expect((await list(token)).body).toEqual({ workspaceContract: 'customer-documentation/v2', workspaces: [{ id: 'alpha', name: 'Alpha customer' }] });
    expect((await scoped(token, 'alpha')).body).toEqual(JSON.parse(readFileSync(new URL('../../../../../examples/documentation-workspaces/session-response.example.json', import.meta.url), 'utf8')));
    expect((await scoped(token, 'beta')).status).toBe(404);
    expect((await scoped(token, 'unknown')).status).toBe(404);
    expect((await check(token)).status).toBe(200);
    expect((await request(server).get('/api/auth/documentation/workspaces').set('Authorization', `Bearer ${browserToken}`)).status).toBe(401);
  });
  it('admits verified exact-domain accounts automatically only when the publisher enables domain admission', async () => {
    const changed = JSON.parse(policy());
    changed.workspaces[0].accessMode = 'verified_domain';
    changed.workspaces[0].readers = [];
    config.documentationWorkspacesJson = JSON.stringify(changed);
    const token = await credential();
    expect((await scoped(token, 'alpha')).status).toBe(200);
    expect((await scoped(token, 'beta')).status).toBe(404);
    for (const email of ['reader@other.test', 'reader@sub.example.test', 'reader@example.test.evil.test']) {
      user.email = email; expect((await scoped(token, 'alpha')).status).toBe(404);
    }
    user.email = 'reader@EXAMPLE.TEST'; expect((await scoped(token, 'alpha')).status).toBe(200);
    user.isEmailVerified = false; expect((await scoped(token, 'alpha')).status).toBe(403);
    user.isEmailVerified = true; user.isActive = false; expect((await scoped(token, 'alpha')).status).toBe(401);
  });
  it('domain admission respects policy removal and rejects contradictory reader restrictions', async () => {
    const changed = JSON.parse(policy()); changed.workspaces[0].accessMode = 'verified_domain';
    config.documentationWorkspacesJson = JSON.stringify(changed);
    const token = await credential(); expect((await scoped(token, 'alpha')).status).toBe(503);
    changed.workspaces[0].readers = []; config.documentationWorkspacesJson = JSON.stringify(changed);
    expect((await scoped(token, 'alpha')).status).toBe(200);
    changed.workspaces[0].active = false; config.documentationWorkspacesJson = JSON.stringify(changed);
    expect((await scoped(token, 'alpha')).status).toBe(404);
    config.documentationWorkspacesJson = undefined; expect((await scoped(token, 'alpha')).status).toBe(404);
  });
  it('never infers customer access from a matching domain or a previously issued token', async () => {
    const token = await credential(); expect((await list(token)).body).toEqual({ workspaceContract: 'customer-documentation/v2', workspaces: [] });
    config.documentationWorkspacesJson = policy(); expect((await scoped(token, 'alpha')).status).toBe(200);
    const changed = JSON.parse(policy()); changed.workspaces[0].readers = []; config.documentationWorkspacesJson = JSON.stringify(changed);
    expect((await scoped(token, 'alpha')).status).toBe(404);
    config.documentationWorkspacesJson = policy(); user.email = 'reader@example.test.evil.test';
    expect((await scoped(token, 'alpha')).status).toBe(404);
    user.email = 'reader@sub.example.test'; expect((await scoped(token, 'alpha')).status).toBe(404);
    user.email = 'reader@EXAMPLE.TEST'; expect((await scoped(token, 'alpha')).status).toBe(200);
  });
  it('rejects expired, inactive and malformed policies without falling back to general reading permission', async () => {
    const token = await credential();
    for (const change of ['expired', 'inactive', 'duplicate', 'wildcard']) {
      const changed = JSON.parse(policy());
      if (change === 'expired') changed.workspaces[0].readers[0].expiresAt = Date.now() - 1;
      if (change === 'inactive') changed.workspaces[0].active = false;
      if (change === 'duplicate') changed.workspaces.push(changed.workspaces[0]);
      if (change === 'wildcard') changed.workspaces[0].allowedEmailDomains = ['*.example.test'];
      config.documentationWorkspacesJson = JSON.stringify(changed);
      expect((await scoped(token, 'alpha')).status).toBe(change === 'duplicate' || change === 'wildcard' ? 503 : 404);
    }
    config.documentationWorkspacesJson = '{'; expect((await list(token)).status).toBe(503);
    config.documentationWorkspacesJson = policy(); user.isEmailVerified = false;
    expect((await scoped(token, 'alpha')).status).toBe(403);
    user.isEmailVerified = true; row.revokedAt = Date.now(); expect((await scoped(token, 'alpha')).status).toBe(401);
  });
});
