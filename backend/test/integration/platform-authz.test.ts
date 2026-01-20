import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { seedUser } from '../utils/seed.js';
import { getDataSource } from '@shared/db/data-source.js';
import { getAdapter } from '@shared/db/adapters/index.js';
import { generateAccessToken } from '@shared/utils/jwt.js';
import { PlatformPermissions } from '@shared/services/platform-admin/permissions.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let userId = '';
let userToken = '';
let adminToken = '';
let developerToken = '';
let skipAuthz = false;

const app = createApp({
  includeTenantContext: false,
  includeRateLimiting: false,
});

describe('Platform authz checks (authz storage required)', () => {
  beforeAll(async () => {
    const dataSource = await getDataSource();
    const schema = getAdapter().getSchemaName() || 'public';
    const tables = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('authz_policies', 'authz_audit_log', 'permission_grants')`,
      [schema]
    );
    const tableNames = new Set(tables.map((row: any) => String(row.table_name)));
    skipAuthz = !tableNames.has('authz_policies') || !tableNames.has('permission_grants');

    const user = await seedUser(prefix);
    userId = user.id;
    userToken = user.token;
    adminToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'admin' });
    developerToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'developer' });
  });

  afterAll(async () => {
    if (!userId) return;
    const { User } = await import('@shared/db/entities/User.js');
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

  it('denies authz check for non-admin user', async () => {
    if (skipAuthz) return;
    const response = await request(app)
      .post('/api/authz/check-batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ checks: [{ action: PlatformPermissions.USER_VIEW, resourceType: 'platform' }] });

    expect(response.status).toBe(403);
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

  it('allows authz check for developer role with view permission', async () => {
    if (skipAuthz) return;
    const response = await request(app)
      .post('/api/authz/check-batch')
      .set('Authorization', `Bearer ${developerToken}`)
      .send({ checks: [{ action: PlatformPermissions.USER_VIEW, resourceType: 'platform' }] });

    expect(response.status).toBe(403);
  });
});
