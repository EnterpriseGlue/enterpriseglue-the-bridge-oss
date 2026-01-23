import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedProject, seedAdditionalUser } from '../utils/seed.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let ownerToken = '';
let ownerId = '';
let otherToken = '';
let otherId = '';
let projectId = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Starbase project delete', () => {
  beforeAll(async () => {
    const owner = await seedUser(prefix);
    ownerToken = owner.token;
    ownerId = owner.id;

    const other = await seedAdditionalUser(prefix, 'other');
    otherToken = other.token;
    otherId = other.id;

    const project = await seedProject(ownerId, `${prefix}-delete-project`);
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [ownerId, otherId]);
  });

  it('allows owner to delete project', async () => {
    const response = await request(app)
      .delete(`/t/default/starbase-api/projects/${projectId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(204);
  });

  it('rejects non-owner project delete', async () => {
    const response = await request(app)
      .delete(`/t/default/starbase-api/projects/${projectId}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
  });
});
