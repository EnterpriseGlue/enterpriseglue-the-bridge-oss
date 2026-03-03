import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../../packages/backend-host/src/app.js';
import { seedUser } from '../utils/seed.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { generateAccessToken } from '@enterpriseglue/shared/utils/jwt.js';
import { PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let userId = '';
let userToken = '';
let adminToken = '';
let developerToken = '';
let skipAuthz = false;

const app = createApp({
  includeRateLimiting: false,
});

describe('Platform authz checks (authz storage required)', () => {
  beforeAll(async () => {
    const dataSource = await getDataSource();
    const queryRunner = dataSource.createQueryRunner();
    try {
      const hasPolicies = await queryRunner.hasTable('authz_policies');
      const hasAudit = await queryRunner.hasTable('authz_audit_log');
      const hasGrants = await queryRunner.hasTable('permission_grants');
      skipAuthz = !hasPolicies || !hasAudit || !hasGrants;
    } finally {
      await queryRunner.release();
    }

    const user = await seedUser(prefix);
    userId = user.id;
    userToken = user.token;
    adminToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'admin' });
    developerToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'developer' });
  });

  afterAll(async () => {
    if (!userId) return;
    const { User } = await import('@enterpriseglue/shared/db/entities/User.js');
    const dataSource = await getDataSource();
    await dataSource.getRepository(User).delete({ id: userId as any });
  });

  it('rejects unauthenticated authz check', async () => {
    if (skipAuthz) return;
    const response = await request(app)
      .post('/api/authz/check-batch')
      .send({ checks: [{ action: PlatformPermissions.USER_VIEW, resourceType: 'platform' }] });

    expect(response.status).toBe(401);
  });

  it('allows authz check for non-admin user but returns denied', async () => {
    if (skipAuthz) return;
    const response = await request(app)
      .post('/api/authz/check-batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ checks: [{ action: PlatformPermissions.USER_VIEW, resourceType: 'platform' }] });

    expect(response.status).toBe(200);
    // Non-admin gets denied in the response body
    expect(response.body?.results?.[0]?.allowed).toBe(false);
  });

  it('allows authz check for admin user', async () => {
    if (skipAuthz) return;
    const response = await request(app)
      .post('/api/authz/check-batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ checks: [{ action: PlatformPermissions.USER_VIEW, resourceType: 'platform' }] });

    expect(response.status).toBe(200);
    const result = response.body?.results?.[0];
    expect(result?.allowed).toBe(true);
  });

  it('allows authz check for developer role with view permission granted', async () => {
    if (skipAuthz) return;
    const response = await request(app)
      .post('/api/authz/check-batch')
      .set('Authorization', `Bearer ${developerToken}`)
      .send({ checks: [{ action: PlatformPermissions.USER_VIEW, resourceType: 'platform' }] });

    expect(response.status).toBe(200);
    // Developer role has view permission granted by default policy
    expect(response.body?.results?.[0]?.allowed).toBe(true);
  });
});
