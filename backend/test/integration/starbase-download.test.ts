import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedFile } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let projectId = '';
let projectIds: string[] = [];
let fileIds: string[] = [];

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase project download', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const project = await seedProject(userId, `${prefix}-download-project`);
    projectId = project.id;
    projectIds.push(projectId);

    const file = await seedFile(projectId, `${prefix}-diagram`, 'bpmn', '<definitions />');
    fileIds.push(file.id);
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, projectIds, [userId], fileIds);
  });

  it('returns a zip for project download', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/download`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
  });

  it('returns 204 when project has no files', async () => {
    const emptyProject = await seedProject(userId, `${prefix}-empty-project`);
    projectIds.push(emptyProject.id);

    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${emptyProject.id}/download`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(204);
  });

  it('rejects unauthenticated project download', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/download`);

    expect(response.status).toBe(401);
  });
});
