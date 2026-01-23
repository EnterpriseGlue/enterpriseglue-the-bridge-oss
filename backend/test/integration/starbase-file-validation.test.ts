import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let token = '';
let userId = '';
let projectId = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase file validation', () => {
  beforeAll(async () => {
    const user = await seedUser(prefix);
    token = user.token;
    userId = user.id;

    const project = await seedProject(userId, `${prefix}-project`);
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [userId]);
  });

  it('rejects file creation with missing name', async () => {
    const response = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'bpmn' });

    expect(response.status).toBe(400);
  });

  it('rejects file creation with empty name', async () => {
    const response = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', type: 'bpmn' });

    expect(response.status).toBe(400);
  });

  it('defaults file type to bpmn when missing', async () => {
    const response = await request(app)
      .post(`/t/default/starbase-api/projects/${projectId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'test.bpmn' });

    expect(response.status).toBe(201);
    expect(response.body?.type).toBe('bpmn');
  });
});
