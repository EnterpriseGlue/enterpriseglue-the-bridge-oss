import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedFile } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let token = '';
let userId = '';
let projectId = '';
let fileId = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase file auth', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    token = user.token;
    userId = user.id;

    const project = await seedProject(userId, `${prefix}-project`);
    projectId = project.id;

    const file = await seedFile(projectId, `${prefix}-file.bpmn`);
    fileId = file.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [userId]);
  });

  it('rejects unauthenticated file update', async () => {
    const response = await request(app)
      .patch(`/t/default/starbase-api/projects/${projectId}/files/${fileId}`)
      .send({ name: 'renamed.bpmn' });

    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated file delete', async () => {
    const response = await request(app)
      .delete(`/t/default/starbase-api/projects/${projectId}/files/${fileId}`);

    expect(response.status).toBe(401);
  });
});
