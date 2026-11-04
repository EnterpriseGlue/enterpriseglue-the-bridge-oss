import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../packages/backend-host/src/app.js';
import { closeDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { seedUser, seedEngine, cleanupEngines, cleanupSeededData } from '../utils/seed.js';

const prefix = `test_history_${Date.now()}`;
const app = createApp({ includeRateLimiting: false, includeDocs: false });
let server: Server;
let token = '';
let userId = '';
let engineId = '';
let calls = 0;
const original = Object.fromEntries(['EG_ENFORCE_ENGINE_ENDPOINT_POLICY', 'EG_ALLOW_INSECURE_ENGINE_HTTP', 'EG_ENGINE_ALLOW_PRIVATE_HOSTS', 'EG_ENGINE_ALLOWED_HOSTS'].map((k) => [k, process.env[k]]));

describe('runtime and historic process error classification with PostgreSQL and actual bounded engine HTTP', () => {
  beforeAll(async () => {
    // Opt in to enforcement even in this disposable loopback fixture. No wildcard hosts.
    Object.assign(process.env, { EG_ENFORCE_ENGINE_ENDPOINT_POLICY: 'true', EG_ALLOW_INSECURE_ENGINE_HTTP: 'true', EG_ENGINE_ALLOW_PRIVATE_HOSTS: 'true', EG_ENGINE_ALLOWED_HOSTS: '127.0.0.1' });
    server = createServer((req, res) => {
      calls++;
      const key = req.url?.split('/').pop();
      res.setHeader('Content-Type', 'application/json');
      if (key === 'known') return res.end(JSON.stringify({ id: 'known', processDefinitionKey: 'qualification', processDefinitionId: 'qualification:1:known', endTime: '2026-11-02T00:00:00Z' }));
      res.statusCode = key === 'forbidden' ? 403 : 404;
      res.end(JSON.stringify({ message: 'synthetic-private-upstream-body' }));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const user = await seedUser(prefix, { platformRole: 'admin' });
    userId = user.id; token = user.token;
    const engine = await seedEngine(userId, `http://127.0.0.1:${(server.address() as AddressInfo).port}/engine-rest`, `${prefix}-engine`, 'operaton');
    engineId = engine.id;
  });
  afterAll(async () => {
    try { if (engineId) await cleanupEngines([engineId]); if (userId) await cleanupSeededData(prefix, [], [userId]); }
    finally {
      await closeDataSource();
      if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
  const read = (id: string) => request(app).get(`/t/default/mission-control-api/history/process-instances/${id}`).query({ engineId }).set('Authorization', `Bearer ${token}`);

  it('reads an existing process through real authentication and engine authorization', async () => {
    const response = await read('known');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe('known');
  });
  it.each(['history/process-instances/missing', 'process-instances/missing', 'process-instances/missing/failed-external-tasks'])('maps actual engine HTTP 404 to a generic 404 without upstream body or ID on %s', async route => {
    const before = calls;
    const response = await request(app).get(`/t/default/mission-control-api/${route}`).query({ engineId }).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', error: 'Process instance not found' });
    expect(calls - before).toBe(1);
  });
  it.each(['history/process-instances', 'process-instances'])('keeps engine-native403 distinct from local tenant denial on %s', async (route) => {
    const response = await request(app).get(`/t/default/mission-control-api/${route}/forbidden`).query({ engineId }).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('ENGINE_OPERATION_REJECTED');
    expect(response.body.details.engineStatus).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain('synthetic-private-upstream-body');
  });
  it.each(['history/process-instances', 'process-instances'])('rejects unauthenticated %s before engine transport', async (route) => {
    const before = calls;
    const response = await request(app).get(`/t/default/mission-control-api/${route}/missing`).query({ engineId });
    expect(response.status).toBe(401);
    expect(calls).toBe(before);
  });
});
