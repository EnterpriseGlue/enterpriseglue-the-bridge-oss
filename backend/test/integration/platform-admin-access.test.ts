import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser } from '../utils/seed.js';
import { generateAccessToken } from '@shared/utils/jwt.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let userId = '';
let userToken = '';
let developerToken = '';
let adminToken = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Platform admin role access', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    userId = user.id;
    userToken = user.token;
    developerToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'developer' });
    adminToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'admin' });
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [], [userId]);
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

  it('rejects developer access', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${developerToken}`);

    expect(response.status).toBe(403);
  });

  it('allows admin access', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
  });
});
