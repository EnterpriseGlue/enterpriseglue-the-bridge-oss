import { describe, expect, it, vi } from 'vitest';
import {
  createLazyConnectionPool,
  type ConnectionPool,
} from '@enterpriseglue/shared/db/db-pool.js';

describe('lazy enterprise connection pool', () => {
  it('does not resolve a raw adapter during ordinary server startup', async () => {
    const nativePool = {};
    const querySpy = vi.fn();
    const pool: ConnectionPool = {
      async query<T = unknown>(sql: string, params?: ReadonlyArray<unknown> | Record<string, unknown>) {
        querySpy(sql, params);
        return { rows: [{ ok: true }] as T[], rowCount: 1 };
      },
      close: vi.fn(async () => undefined),
      getNativePool: vi.fn(() => nativePool),
    };
    const resolvePool = vi.fn(() => pool);
    const closePool = vi.fn(async () => undefined);

    const lazy = createLazyConnectionPool(resolvePool, closePool);
    expect(resolvePool).not.toHaveBeenCalled();

    await expect(lazy.query('SELECT portable')).resolves.toEqual({
      rows: [{ ok: true }],
      rowCount: 1,
    });
    expect(resolvePool).toHaveBeenCalledTimes(1);
    expect(lazy.getNativePool()).toBe(nativePool);
    expect(resolvePool).toHaveBeenCalledTimes(2);

    await lazy.close();
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});
