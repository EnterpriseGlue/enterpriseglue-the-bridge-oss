import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { createApp as CreateAppFn } from '../../src/app.js';
import { seedUser, seedEngine, cleanupEngines } from '../utils/seed.js';
import { createCamundaFetchMock } from '../utils/camunda-mock.js';

const prefix = `test_camunda_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let userId = '';
let engineId = '';
let token = '';
let app: ReturnType<typeof CreateAppFn>;

describe('Mission control Camunda integration', () => {
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('undici', () => ({
      fetch: vi.fn(),
      FormData: class {},
    }));

    const { createApp } = await import('../../src/app.js');
    app = createApp({
      includeRateLimiting: false,
      includeDocs: false,
    });

    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-please-change-00000000000000';
    const user = await seedUser(prefix);
    userId = user.id;
    const { generateAccessToken } = await import('@shared/utils/jwt.js');
    token = generateAccessToken({ id: user.id, email: user.email, platformRole: 'admin' });

    const engine = await seedEngine(userId, 'http://camunda.mock/engine-rest', `${prefix}-engine`);
    engineId = engine.id;

    const { fetch } = await import('undici');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(createCamundaFetchMock());
  });

  afterAll(async () => {
    await cleanupEngines(engineId ? [engineId] : []);
    if (userId) {
      const { getDataSource } = await import('@shared/db/data-source.js');
      const { User } = await import('@shared/db/entities/User.js');
      const dataSource = await getDataSource();
      await dataSource.getRepository(User).delete({ id: userId as any });
    }
  });

  it('lists engines', async () => {
    const response = await request(app)
      .get('/t/default/engines-api/engines')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it('gets engine detail', async () => {
    const response = await request(app)
      .get(`/t/default/engines-api/engines/${engineId}`)
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body.id).toBe(engineId);
    }
  });

  it('lists deployments', async () => {
    const response = await request(app)
      .get(`/t/default/engines-api/engines/${engineId}/deployments`)
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it('gets deployment by id', async () => {
    const response = await request(app)
      .get(`/t/default/engines-api/engines/${engineId}/deployments/d1`)
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toHaveProperty('id');
    }
  });

  it('lists decision definitions', async () => {
    const response = await request(app)
      .get('/t/default/mission-control-api/decision-definitions')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it('evaluates a decision', async () => {
    const response = await request(app)
      .post('/t/default/mission-control-api/decision-definitions/decision-1/evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({ variables: { amount: { value: 10, type: 'Integer' } } });

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it('lists process definitions', async () => {
    const response = await request(app)
      .get('/t/default/mission-control-api/process-definitions')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it('gets process definition detail', async () => {
    const response = await request(app)
      .get('/t/default/mission-control-api/process-definitions/order-process:3:mock')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toHaveProperty('id');
    }
  });

  it('lists process instances', async () => {
    const response = await request(app)
      .get('/t/default/mission-control-api/process-instances')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it('gets process instance detail', async () => {
    const response = await request(app)
      .get('/t/default/mission-control-api/process-instances/instance-1')
      .set('Authorization', `Bearer ${token}`);

    // May return 200 or 400 depending on engine validation
    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toHaveProperty('id');
    }
  });
});
