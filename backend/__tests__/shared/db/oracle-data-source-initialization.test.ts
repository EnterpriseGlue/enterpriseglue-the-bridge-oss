import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  dataSource: { isInitialized: false, initialize: vi.fn(), destroy: vi.fn() },
  assertContext: vi.fn(),
}));
vi.mock('typeorm', () => ({ DataSource: class { constructor() { return fixture.dataSource; } } }));
vi.mock('@enterpriseglue/shared/db/adapters/index.js', () => ({ getAdapter: () => ({ getDataSourceOptions: () => ({ type: 'oracle' }) }) }));
vi.mock('@enterpriseglue/shared/db/TimestampedTypeOrmLogger.js', () => ({ TimestampedTypeOrmLogger: class {} }));
vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({ logger: { info: vi.fn() } }));
vi.mock('@enterpriseglue/shared/infrastructure/persistence/subscribers/TenantRlsSubscriber.js', () => ({
  installPostgresContextBoundary: vi.fn(), assertPostgresContextBoundary: fixture.assertContext,
}));

import { AppDataSource, closeDataSource, getDataSource } from '@enterpriseglue/shared/db/data-source.js';

beforeEach(() => {
  fixture.dataSource.initialize.mockImplementation(async () => { fixture.dataSource.isInitialized = true; });
  fixture.dataSource.destroy.mockImplementation(async () => { fixture.dataSource.isInitialized = false; });
});
afterEach(async () => { await closeDataSource(); vi.resetAllMocks(); });

describe('Oracle application datasource lifecycle', () => {
  it('shares one datasource initialization across concurrent startup callers', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => getDataSource()));
    expect(results.every(result => result === AppDataSource)).toBe(true);
    expect(fixture.dataSource.initialize).toHaveBeenCalledTimes(1);
    expect(fixture.assertContext).toHaveBeenCalledTimes(1);
  });
  it('shares a failure and permits a later initialization retry', async () => {
    fixture.dataSource.initialize.mockRejectedValueOnce(new Error('fixture connection rejected'));
    const results = await Promise.allSettled([getDataSource(), getDataSource()]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(fixture.dataSource.initialize).toHaveBeenCalledTimes(1);
    await expect(getDataSource()).resolves.toBe(AppDataSource);
    expect(fixture.dataSource.initialize).toHaveBeenCalledTimes(2);
  });
  it('retains the context boundary and destroys a failed initialization before retry', async () => {
    fixture.assertContext.mockImplementationOnce(() => { throw new Error('fixture context boundary failed'); });
    await expect(getDataSource()).rejects.toThrow('context boundary failed');
    expect(fixture.dataSource.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.dataSource.isInitialized).toBe(false);
    await expect(getDataSource()).resolves.toBe(AppDataSource);
    expect(fixture.dataSource.initialize).toHaveBeenCalledTimes(2);
  });
  it('waits for pending initialization before closing and supports a subsequent reopen', async () => {
    let finish!: () => void;
    fixture.dataSource.initialize.mockImplementationOnce(() => new Promise<void>(resolve => {
      finish = () => { fixture.dataSource.isInitialized = true; resolve(); };
    }));
    const opening = getDataSource();
    const closing = closeDataSource();
    expect(fixture.dataSource.destroy).not.toHaveBeenCalled();
    finish();
    await opening; await closing;
    expect(fixture.dataSource.destroy).toHaveBeenCalledTimes(1);
    await expect(getDataSource()).resolves.toBe(AppDataSource);
    expect(fixture.dataSource.initialize).toHaveBeenCalledTimes(2);
  });
});
