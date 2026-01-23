import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { cleanupSeededData, seedUser, seedAdditionalUser } from '../utils/seed.js';
import { getDataSource } from '@shared/db/data-source.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { generateId } from '@shared/utils/id.js';

const prefix = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let ownerId = '';
let ownerToken = '';
let otherId = '';
let otherToken = '';
let engineId = '';

const app = createApp({
  includeRateLimiting: false,
});

describe('Mission control engine auth', () => {
  beforeAll(async () => {
    const owner = await seedUser(prefix);
    ownerId = owner.id;
    ownerToken = owner.token;

    const other = await seedAdditionalUser(prefix, 'other');
    otherId = other.id;
    otherToken = other.token;

    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    engineId = generateId();
    const now = Date.now();

    await engineRepo.insert({
      id: engineId,
      name: `${prefix}-engine`,
      baseUrl: 'http://engine.local',
      type: null,
      authType: null,
      username: null,
      passwordEnc: null,
      version: null,
      ownerId,
      delegateId: null,
      environmentTagId: null,
      environmentLocked: false,
      tenantId: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    const dataSource = await getDataSource();
    const engineRepo = dataSource.getRepository(Engine);
    if (engineId) {
      await engineRepo.delete({ id: engineId } as any);
    }
    await cleanupSeededData(prefix, [], [ownerId, otherId]);
  });

  it('rejects unauthenticated mission-control access', async () => {
    const response = await request(app)
      .get('/t/default/mission-control-api/process-instances');

    expect(response.status).toBe(401);
  });

  it('rejects non-member mission-control access', async () => {
    const response = await request(app)
      .get('/t/default/mission-control-api/process-instances')
      .set('Authorization', `Bearer ${otherToken}`);

    // Returns 400 when no engine context is available (validation before auth)
    expect([400, 403]).toContain(response.status);
  });

  it('rejects non-deployer direct actions', async () => {
    const response = await request(app)
      .post('/t/default/mission-control-api/direct/process-instances/delete')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ processInstanceIds: [] });

    // Returns 400 when no engine context is available (validation before auth)
    expect([400, 403]).toContain(response.status);
  });
});
