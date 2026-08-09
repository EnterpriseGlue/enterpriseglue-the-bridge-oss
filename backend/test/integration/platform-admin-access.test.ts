import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../../packages/backend-host/src/app.js';
import { cleanupSeededData, seedUser } from '../utils/seed.js';
import { generateAccessToken } from '@enterpriseglue/shared/utils/jwt.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let userId = '';
let adminUserId = '';
let userToken = '';
let standardUserToken = '';
let adminToken = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Platform admin role access', () => {
  beforeAll(async () => {
    const [user, admin] = await Promise.all([
      seedUser(prefix),
      seedUser(`${prefix}-admin`, { platformRole: 'admin' }),
    ]);
    userId = user.id;
    adminUserId = admin.id;
    userToken = user.token;
    standardUserToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'user' });
    adminToken = admin.token;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [], [userId, adminUserId]);
  });

  it('rejects unauthenticated admin access', async () => {
    const response = await request(app).get('/api/users');

    expect(response.status).toBe(401);
  });

  it('rejects non-admin user access', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(403);
  });

  it('rejects standard user access', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${standardUserToken}`);

    expect(response.status).toBe(403);
  });

  it('allows admin access', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
  });
});
