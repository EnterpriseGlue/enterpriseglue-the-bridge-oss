import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedFolder } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let projectId = '';
let folderId = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase folder download', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const project = await seedProject(userId, `${prefix}-folder-project`);
    projectId = project.id;

    const folder = await seedFolder(projectId, `${prefix}-folder`);
    folderId = folder.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [userId], [], [folderId]);
  });

  it('returns 204 when folder has no files', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/folders/${folderId}/download`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(204);
  });

  it('rejects unauthenticated folder download', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/folders/${folderId}/download`);

    expect(response.status).toBe(401);
  });
});
