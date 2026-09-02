import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';

const mockConfig = vi.hoisted(() => ({
  nodeEnv: 'test' as const,
  postgresSchema: 'onejob_sbx',
  postgresSsl: false,
  postgresSslRejectUnauthorized: false as boolean,
  postgresUrl: undefined as string | undefined,
  postgresHost: undefined as string | undefined,
  postgresPort: undefined as number | undefined,
  postgresUser: undefined as string | undefined,
  postgresPassword: undefined as string | undefined,
  postgresDatabase: undefined as string | undefined,
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config: mockConfig, shouldUseSecureCookies: () => false }));

import { PostgresAdapter } from '@enterpriseglue/shared/db/adapters/PostgresAdapter.js';

type TableSnapshot = { table: any; schema: any };

describe('PostgresAdapter metadata normalization', () => {
  let tableSnapshots: TableSnapshot[] = [];

  beforeEach(() => {
    const metadata = getMetadataArgsStorage();
    tableSnapshots = metadata.tables.map((table: any) => ({ table, schema: table.schema }));
  });

  afterEach(() => {
    for (const snapshot of tableSnapshots) {
      snapshot.table.schema = snapshot.schema;
    }
  });

  it('maps shared main schema entities to configured Postgres schema', () => {
    new PostgresAdapter();

    const metadata = getMetadataArgsStorage();
    const usersTable = metadata.tables.find((table: any) => table.name === 'users');
    const permissionGrantsTable = metadata.tables.find((table: any) => table.name === 'permission_grants');

    expect(usersTable?.schema).toBe('onejob_sbx');
    expect(permissionGrantsTable?.schema).toBe('onejob_sbx');
  });

  it('keeps the EngineHealth BIGINT timestamp transformer active', () => {
    new PostgresAdapter();

    const checkedAtColumn = getMetadataArgsStorage().columns.find(
      (column: any) => column.target?.name === 'EngineHealth' && column.propertyName === 'checkedAt',
    );
    const transformer = Array.isArray(checkedAtColumn?.options.transformer)
      ? checkedAtColumn?.options.transformer[0]
      : checkedAtColumn?.options.transformer;

    expect(checkedAtColumn?.options.type).toBe('bigint');
    expect(transformer?.from('1700000000000')).toBe(1700000000000);
  });
});
