import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedFile } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let projectId = '';
let fileId = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase file download', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const project = await seedProject(userId, `${prefix}-file-download-project`);
    projectId = project.id;

    const file = await seedFile(projectId, `${prefix}-file`, 'bpmn', '<definitions />');
    fileId = file.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [userId], [fileId]);
  });

  it('returns XML download for file', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/files/${fileId}/download`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
  });

  it('rejects unauthenticated file download', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/files/${fileId}/download`);

    expect(response.status).toBe(401);
  });
});
