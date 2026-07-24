import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { SqlServerAdapter } from '@enterpriseglue/shared/db/adapters/SqlServerAdapter.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    nodeEnv: 'test',
    mssqlSchema: 'dbo',
    mssqlHost: 'db',
    mssqlPort: 1433,
    mssqlUser: 'sa',
    mssqlPassword: 'change_me',
    mssqlDatabase: 'enterpriseglue',
    mssqlEncrypt: false,
    mssqlTrustServerCertificate: true,
  },
}));

describe('SqlServerAdapter metadata normalization', () => {
  let columnSnapshots: Array<{
    column: any;
    type: any;
    length: any;
  }> = [];
  let tableSnapshots: Array<{
    table: any;
    schema: any;
  }> = [];
  let indexSnapshots: Array<{
    index: any;
    where: any;
  }> = [];

  beforeEach(() => {
    const metadata = getMetadataArgsStorage();
    columnSnapshots = metadata.columns.map((column) => ({
      column,
      type: column.options.type,
      length: column.options.length,
    }));
    tableSnapshots = metadata.tables.map((table) => ({ table, schema: table.schema }));
    indexSnapshots = metadata.indices.map((index) => ({ index, where: index.where }));
  });

  afterEach(() => {
    for (const snapshot of columnSnapshots) {
      snapshot.column.options.type = snapshot.type;
      snapshot.column.options.length = snapshot.length;
    }
    for (const snapshot of tableSnapshots) {
      snapshot.table.schema = snapshot.schema;
    }
    for (const snapshot of indexSnapshots) {
      snapshot.index.where = snapshot.where;
    }
  });

  it('maps shared main schema entities to the configured SQL Server schema', () => {
    new SqlServerAdapter();

    const usersTable = getMetadataArgsStorage().tables.find((table) => table.name === 'users');
    const groupsTable = getMetadataArgsStorage().tables.find((table) => table.name === 'authz_groups');
    expect(usersTable?.schema).toBe('dbo');
    expect(groupsTable?.schema).toBe('dbo');
  });

  it('uses comparable nvarchar columns for both keys and descriptive text', () => {
    new SqlServerAdapter();

    const metadata = getMetadataArgsStorage();
    const idColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'AppBaseEntity' && column.propertyName === 'id',
    );
    const groupKeyColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'AuthzGroup'
        && column.propertyName === 'groupKeyIdentity',
    );
    const groupDescriptionColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'AuthzGroup'
        && column.propertyName === 'description',
    );

    expect(idColumn?.options.type).toBe('nvarchar');
    expect(idColumn?.options.length).toBe(191);
    expect(groupKeyColumn?.options.type).toBe('nvarchar');
    expect(groupKeyColumn?.options.length).toBe(191);
    expect(groupDescriptionColumn?.options.type).toBe('nvarchar');
    expect(groupDescriptionColumn?.options.length).toBe(4000);
  });

  it('uses NVARCHAR(MAX) for bounded native-grant evidence instead of truncating it to display-text length', () => {
    new SqlServerAdapter();
    const metadata = getMetadataArgsStorage();
    for (const propertyName of ['classificationsJson', 'encryptedDetailedSnapshot']) {
      const column = metadata.columns.find((candidate) => (candidate.target as any)?.name === 'CamundaNativeGrantImportRun'
        && candidate.propertyName === propertyName);
      expect(column?.options).toMatchObject({ type: 'nvarchar', length: 'MAX' });
    }
  });

  it('filters nullable unique keys so multiple absent values remain valid', () => {
    new SqlServerAdapter();

    const configKeyIndex = getMetadataArgsStorage().indices.find(
      (index) => (index.target as any)?.name === 'Engine'
        && index.name === 'uq_engines_config_key_identity',
    );
    expect(configKeyIndex?.unique).toBe(true);
    expect(configKeyIndex?.where).toBe('[config_key_identity] IS NOT NULL');
  });
});
