import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedFolder, seedFile, seedAdditionalUser } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let authToken = '';
let userId = '';
let otherToken = '';
let otherUserId = '';
let projectId = '';
let folderId = '';
let fileIds: string[] = [];

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase project contents', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    authToken = user.token;
    userId = user.id;

    const other = await seedAdditionalUser(prefix, 'other');
    otherToken = other.token;
    otherUserId = other.id;

    const project = await seedProject(userId, `${prefix}-contents-project`);
    projectId = project.id;

    const folder = await seedFolder(projectId, `${prefix}-contents-folder`);
    folderId = folder.id;

    const file = await seedFile(projectId, `${prefix}-contents-file`, 'bpmn', '<xml />', folderId);
    fileIds.push(file.id);
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [userId, otherUserId], fileIds, [folderId]);
  });

  it('lists root contents with folders', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/contents`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    const folderNames = (response.body?.folders || []).map((f: any) => f.name);
    expect(folderNames).toContain(`${prefix}-contents-folder`);
  });

  it('lists folder contents with files', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/contents?folderId=${folderId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    const fileNames = (response.body?.files || []).map((f: any) => f.name);
    expect(fileNames).toContain(`${prefix}-contents-file`);
  });

  it('rejects unauthenticated contents requests', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/contents`);

    expect(response.status).toBe(401);
  });

  it('rejects non-member contents requests', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/contents`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(404);
  });
});
