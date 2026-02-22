import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser } from '../utils/seed.js';
import { generateAccessToken } from '@shared/utils/jwt.js';
import { getDataSource } from '@shared/db/data-source.js';
import { PlatformSettings } from '@shared/db/entities/PlatformSettings.js';

const prefix = `test_pii_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let userId = '';
let adminToken = '';
let userToken = '';

const app = createApp({ includeRateLimiting: false });

async function cleanupPlatformSettings() {
  const dataSource = await getDataSource();
  await dataSource.getRepository(PlatformSettings).delete({ id: 'default' });
}

describe('Platform settings PII fields API', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    userId = user.id;
    userToken = user.token;
    adminToken = generateAccessToken({ id: user.id, email: user.email, platformRole: 'admin' });
    await cleanupPlatformSettings();
  });

  afterAll(async () => {
    await cleanupPlatformSettings();
    await cleanupSeededData(prefix, [], [userId]);
  });

  it('rejects non-admin GET of platform settings', async () => {
    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(403);
  });

  it('returns default PII settings when no row exists', async () => {
    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      piiRegexEnabled: false,
      piiExternalProviderEnabled: false,
      piiExternalProviderType: null,
      piiExternalProviderAuthToken: null,
      piiRedactionStyle: '<TYPE>',
      piiMaxPayloadSizeBytes: 262144,
    });
    expect(Array.isArray(res.body.piiScopes)).toBe(true);
  });

  it('allows admin to enable regex PII filtering', async () => {
    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ piiRegexEnabled: true, piiScopes: ['logs', 'errors'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('reflects updated PII settings on subsequent GET', async () => {
    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.piiRegexEnabled).toBe(true);
    expect(res.body.piiScopes).toEqual(expect.arrayContaining(['logs', 'errors']));
  });

  it('masks auth token in GET response after saving it', async () => {
    const putRes = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        piiExternalProviderEnabled: true,
        piiExternalProviderType: 'presidio',
        piiExternalProviderEndpoint: 'https://presidio.local',
        piiExternalProviderAuthToken: 'super-secret-token',
      });

    expect(putRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.piiExternalProviderAuthToken).toBeNull();
    expect(getRes.body.piiExternalProviderEndpoint).toBe('https://presidio.local');
  });

  it('allows admin to disable PII filtering', async () => {
    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ piiRegexEnabled: false, piiExternalProviderEnabled: false });

    expect(res.status).toBe(200);

    const getRes = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.body.piiRegexEnabled).toBe(false);
    expect(getRes.body.piiExternalProviderEnabled).toBe(false);
  });

  it('rejects non-admin PUT of platform settings', async () => {
    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ piiRegexEnabled: true });

    expect(res.status).toBe(403);
  });
});
