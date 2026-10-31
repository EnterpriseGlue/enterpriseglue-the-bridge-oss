import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { EngineAccessRequest } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineAccessRequest.js';
import { EngineProjectAccess } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineProjectAccess.js';
import { ProjectEngineAccessResponseSchema } from '@enterpriseglue/shared/schemas/starbase/project-engine-access.js';

const env = (name: string, fallback: string) => process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const database = `project_access_${randomUUID().replace(/-/g, '')}`;
const connection = {
  type: 'postgres' as const,
  host: env('POSTGRES_HOST', '127.0.0.1'),
  port: Number(env('POSTGRES_PORT', '5432')),
  username: env('POSTGRES_USER', 'postgres'),
  password: env('POSTGRES_PASSWORD', 'postgres'),
};
const admin = new DataSource({ ...connection, database: env('POSTGRES_DATABASE', 'postgres') });
const store = new DataSource({ ...connection, database, entities: [EngineAccessRequest, EngineProjectAccess], synchronize: true });
let databaseCreated = false;
const timestamp = 1700000000000;

describe('PostgreSQL project engine access timestamps', () => {
  beforeAll(async () => {
    await admin.initialize();
    // This UUID-derived database belongs only to this test file, never the host's application schema.
    await admin.query(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    const schema = new DataSource({ ...connection, database });
    try { await schema.initialize(); await schema.query('CREATE SCHEMA main'); }
    finally { if (schema.isInitialized) await schema.destroy(); }
    await store.initialize();
  }, 30000);

  afterEach(async () => {
    if (store.isInitialized) {
      await store.getRepository(EngineAccessRequest).clear();
      await store.getRepository(EngineProjectAccess).clear();
    }
  });

  afterAll(async () => {
    if (store.isInitialized) await store.destroy();
    if (admin.isInitialized) {
      try { if (databaseCreated) await admin.query(`DROP DATABASE "${database}"`); }
      finally { await admin.destroy(); }
    }
  });

  it('hydrates real BIGINT strings into the numeric pending-request and access-grant contract', async () => {
    await store.getRepository(EngineAccessRequest).insert({
      id: 'request-1', projectId: 'project-1', engineId: 'engine-1', requestedById: 'user-1',
      status: 'pending', createdAt: timestamp,
    });
    await store.getRepository(EngineProjectAccess).insert({
      id: 'grant-1', projectId: 'project-1', engineId: 'engine-1', createdAt: timestamp,
    });
    const [raw] = await store.query('SELECT created_at FROM main.engine_access_requests');
    expect(raw.created_at).toBe(String(timestamp));
    const [pending] = await store.getRepository(EngineAccessRequest).find({ select: ['id', 'engineId', 'createdAt', 'reviewedAt'] });
    const [grant] = await store.getRepository(EngineProjectAccess).find({ select: ['engineId', 'createdAt'] });
    expect(pending.reviewedAt).toBeNull();
    const response = ProjectEngineAccessResponseSchema.parse({
      accessedEngines: [{ engineId: grant.engineId, engineName: 'Engine', baseUrl: 'https://engine.invalid',
        environment: null, health: null, grantedAt: grant.createdAt }],
      pendingRequests: [{ requestId: pending.id, engineId: pending.engineId, engineName: 'Engine', requestedAt: pending.createdAt }],
      availableEngines: [],
    });
    expect(response.accessedEngines[0].grantedAt).toBe(timestamp);
    expect(response.pendingRequests[0].requestedAt).toBe(timestamp);
  });

  it('preserves numeric reviewed timestamps when a request changes status', async () => {
    const repo = store.getRepository(EngineAccessRequest);
    await repo.insert({ id: 'request-1', projectId: 'project-1', engineId: 'engine-1',
      requestedById: 'user-1', status: 'pending', createdAt: timestamp });
    await repo.update('request-1', { status: 'approved', reviewedAt: timestamp + 1, reviewedById: 'reviewer-1' });
    expect(await repo.findOneByOrFail({ id: 'request-1' })).toMatchObject({
      createdAt: timestamp, reviewedAt: timestamp + 1, status: 'approved',
    });
  });

  it.each([
    ['engine_access_requests', 'created_at'],
    ['engine_access_requests', 'reviewed_at'],
    ['engine_project_access', 'created_at'],
  ])('rejects precision loss in %s.%s rather than rounding persisted values', async (table, column) => {
    const unsafe = '9007199254740993';
    if (table === 'engine_access_requests') {
      await store.getRepository(EngineAccessRequest).insert({ id: 'request-1', projectId: 'project-1', engineId: 'engine-1',
        requestedById: 'user-1', createdAt: timestamp });
    } else {
      await store.getRepository(EngineProjectAccess).insert({ id: 'grant-1', projectId: 'project-1', engineId: 'engine-1', createdAt: timestamp });
    }
    await store.query(`UPDATE main.${table} SET ${column} = $1`, [unsafe]);
    await expect(store.getRepository(table === 'engine_access_requests' ? EngineAccessRequest : EngineProjectAccess).find())
      .rejects.toThrow('Database BIGINT value is not a safe integer');
  });
});
