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

describe('Starbase members access', () => {
  beforeAll(async () => {
    const owner = await seedUser(prefix);
    ownerToken = owner.token;
    ownerId = owner.id;

    const other = await seedAdditionalUser(prefix, 'other');
    otherToken = other.token;
    otherId = other.id;

    const project = await seedProject(ownerId, `${prefix}-members-project`);
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupSeededData(prefix, [projectId], [ownerId, otherId]);
  });

  it('returns 403 for non-member access', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBeGreaterThanOrEqual(403);
  });

  it('allows owner to list members', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
  });

  it('returns 403 for non-member user search', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/members/user-search?q=te`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
  });

  it('allows owner to search users', async () => {
    const response = await request(app)
      .get(`/t/default/starbase-api/projects/${projectId}/members/user-search?q=te`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
  });
});
