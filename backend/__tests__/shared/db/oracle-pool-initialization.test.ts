import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const connection = { execute: vi.fn(async () => ({ rows: [{ OK: 1 }] })), close: vi.fn(async () => undefined) };
  const pool = { getConnection: vi.fn(async () => connection), close: vi.fn(async () => undefined) };
  return { pool, createPool: vi.fn(async () => pool) };
});
vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config: {
  databaseType: 'oracle', oracleConnectionString: 'db:1521/app', oracleUser: 'fixture', oraclePassword: 'fixture',
} }));
vi.mock('@enterpriseglue/shared/db/adapters/index.js', () => ({ getAdapter: () => ({ getDatabaseType: () => 'oracle' }) }));
vi.mock('oracledb', () => ({ default: { createPool: fixture.createPool, OUT_FORMAT_OBJECT: 4002 } }));

import { closeConnectionPool, getConnectionPool } from '@enterpriseglue/shared/db/db-pool.js';

afterEach(async () => { await closeConnectionPool(); vi.clearAllMocks(); });
describe('Oracle physical pool initialization', () => {
  it('shares one initialization across concurrent first queries', async () => {
    const pool = getConnectionPool();
    await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT 1 FROM dual')));
    expect(fixture.createPool).toHaveBeenCalledTimes(1);
    expect(fixture.createPool).toHaveBeenCalledWith(expect.objectContaining({ poolMax: 10 }));
  });
  it('allows a later retry after one shared initialization failure', async () => {
    fixture.createPool.mockRejectedValueOnce(new Error('fixture connection rejected'));
    const pool = getConnectionPool();
    const outcomes = await Promise.allSettled([pool.query('SELECT 1 FROM dual'), pool.query('SELECT 1 FROM dual')]);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(fixture.createPool).toHaveBeenCalledTimes(1);
    await expect(pool.query('SELECT 1 FROM dual')).resolves.toEqual({ rows: [{ OK: 1 }], rowCount: 0 });
    expect(fixture.createPool).toHaveBeenCalledTimes(2);
  });
});
