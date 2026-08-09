import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { EnterpriseDatabaseType } from '@enterpriseglue/enterprise-plugin-api/backend';
import { createEnterpriseDatabaseContext } from '@enterpriseglue/backend-host/services/enterpriseDatabaseContext.js';

const databaseTypes: EnterpriseDatabaseType[] = ['postgres', 'oracle', 'mysql', 'mssql', 'spanner'];

describe.each(databaseTypes)('enterprise database context on %s', (databaseType) => {
  it('exposes the initialized TypeORM source without opening a raw driver pool', async () => {
    const manager = { adapter: databaseType };
    const transaction = vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(manager));
    const dataSource = { transaction } as unknown as DataSource;
    const resolveDataSource = vi.fn(async () => dataSource);
    const context = createEnterpriseDatabaseContext({ databaseType, resolveDataSource });

    expect(context).toMatchObject({ kind: 'typeorm', databaseType });
    await expect(context.getDataSource<DataSource>()).resolves.toBe(dataSource);
    await expect(context.transaction(async (value) => ({ value }))).resolves.toEqual({ value: manager });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(resolveDataSource).toHaveBeenCalledTimes(2);
  });
});
