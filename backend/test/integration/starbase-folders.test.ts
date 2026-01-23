import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedAdditionalUser } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let otherToken = '';
let otherUserId = '';
let projectId = '';
let folderIds: string[] = [];

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase folders', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const other = await seedAdditionalUser(prefix, 'other');
    otherToken = other.token;
    otherUserId = other.id;

    const project = await seedProject(userId, `${prefix}-folders-project`);
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [userId, otherUserId], [], folderIds);
  });

  it('creates and lists folders', async () => {
    const createResponse = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/folders`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-folder` });

    expect(createResponse.status).toBe(201);
    folderIds.push(String(createResponse.body?.id));

    const listResponse = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/folders`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(listResponse.status).toBe(200);
    const names = (listResponse.body || []).map((f: any) => f.name);
    expect(names).toContain(`${prefix}-folder`);
  });

  it('rejects duplicate folder names in the same parent', async () => {
    const firstResponse = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/folders`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-dup-folder` });

    expect(firstResponse.status).toBe(201);
    folderIds.push(String(firstResponse.body?.id));

    const dupResponse = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/folders`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-dup-folder` });

    expect(dupResponse.status).toBe(400);
  });

  it('renames a folder', async () => {
    const createResponse = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/folders`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-rename-folder` });

    expect(createResponse.status).toBe(201);
    const renameId = String(createResponse.body?.id);
    folderIds.push(renameId);

    const renameResponse = await request(app)
      .patch(`/t/default/starbase-api/folders/${renameId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `${prefix}-renamed-folder` });

    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body?.name).toBe(`${prefix}-renamed-folder`);
  });

  it('rejects unauthenticated folder rename', async () => {
    const response = await request(app)
      .patch(`/t/default/starbase-api/folders/00000000-0000-0000-0000-000000000000`)
      .send({ name: `${prefix}-fail` });

    expect(response.status).toBe(401);
  });

  it('rejects non-member folder creation', async () => {
    const response = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/folders`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: `${prefix}-other-folder` });

    expect(response.status).toBeGreaterThanOrEqual(403);
  });

  it('validates missing folder name', async () => {
    const response = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/folders`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(response.status).toBe(400);
  });
});
