import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedFolder, seedFile } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let projectId = '';
let folderId = '';
let fileIds: string[] = [];

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase folder delete preview', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const project = await seedProject(userId, `${prefix}-preview-project`);
    projectId = project.id;

    const folder = await seedFolder(projectId, `${prefix}-preview-folder`);
    folderId = folder.id;

    const file = await seedFile(projectId, `${prefix}-preview-file`, 'bpmn', '<xml />', folderId);
    fileIds.push(file.id);
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [userId], fileIds, [folderId]);
  });

  it('returns counts and sample paths', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/folders/${folderId}/delete-preview`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body?.folderCount).toBeGreaterThan(0);
    expect(response.body?.fileCount).toBeGreaterThan(0);
  });

  it('rejects unauthenticated delete preview', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/folders/${folderId}/delete-preview`);

    expect(response.status).toBe(401);
  });
});
