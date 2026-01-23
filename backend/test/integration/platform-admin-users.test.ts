import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser } from '../utils/seed.js';
import { generateAccessToken } from '@shared/utils/jwt.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let userId = '';
let userToken = '';
let adminToken = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Platform admin user listing', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    userId = user.id;
    userToken = user.token;
    adminToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'admin' });
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [], [userId]);
  });

  it('rejects non-admin access to user list', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(403);
  });

  it('allows admin access to user list', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
