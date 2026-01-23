import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedAdditionalUser, seedProject } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let otherToken = '';
let otherUserId = '';
let seededProjectId = '';
let createdProjectIds: string[] = [];

describe('Starbase projects', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const other = await seedAdditionalUser(prefix, 'other');
    otherToken = other.token;
    otherUserId = other.id;

    const seededProject = await seedProject(userId, `${prefix}-engine-access-project`);
    seededProjectId = seededProject.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [seededProjectId, ...createdProjectIds], [userId, otherUserId]);
  });

  it('creates and lists projects for the owner', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const createResponse = await request(app)
      .post('/t/default/starbase-api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-project` });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body?.name).toBe(`${prefix}-project`);

    const createdId = String(createResponse.body?.id);
    createdProjectIds.push(createdId);

    const listResponse = await request(app)
      .get('/t/default/starbase-api/projects')
      .set('Authorization', `Bearer ${authToken}`);

    expect(listResponse.status).toBe(200);
    const names = (listResponse.body || []).map((p: any) => p.name);
    expect(names).toContain(`${prefix}-project`);
  });

  it('renames a project', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const createResponse = await request(app)
      .post('/t/default/starbase-api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-rename-project` });

    expect(createResponse.status).toBe(200);
    const renameId = String(createResponse.body?.id);
    createdProjectIds.push(renameId);

    const renameResponse = await request(app)
      .patch(`/t/default/starbase-api/projects/${renameId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-renamed-project` });

    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body?.name).toBe(`${prefix}-renamed-project`);
  });

  it('rejects unauthenticated rename', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const response = await request(app)
      .patch('/t/default/starbase-api/projects/00000000-0000-0000-0000-000000000000')
      .send({ name: `${prefix}-fail` });

    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated delete', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const response = await request(app)
      .delete('/t/default/starbase-api/projects/00000000-0000-0000-0000-000000000000');

    expect(response.status).toBe(401);
  });

  it('rejects non-member engine access lookup', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${seededProjectId}/engine-access`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
  });

  it('rejects non-member project rename', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const response = await request(app)
      .patch(`/t/default/starbase-api/projects/${seededProjectId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: `${prefix}-rename-deny` });

    expect(response.status).toBe(403);
  });

  it('rejects non-member project delete', async () => {
    const app = createApp({
      includeRateLimiting: false,
    });

    const response = await request(app)
      .delete(`/t/default/starbase-api/projects/${seededProjectId}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
  });
});
