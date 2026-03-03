import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { OracleAdapter } from '@enterpriseglue/shared/db/adapters/OracleAdapter.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    nodeEnv: 'test',
    oracleSchema: 'enterpriseglue',
    oracleHost: 'db',
    oraclePort: 1521,
    oracleUser: 'enterpriseglue',
    oraclePassword: 'change_me',
    oracleServiceName: 'XEPDB1',
    oracleSid: undefined,
  },
}));

type ColumnSnapshot = {
  column: any;
  type: any;
  length: any;
  precision: any;
  scale: any;
  transformer: any;
};

type TableSnapshot = {
  table: any;
  schema: any;
};

describe('OracleAdapter metadata normalization', () => {
  let columnSnapshots: ColumnSnapshot[] = [];
  let tableSnapshots: TableSnapshot[] = [];

  beforeEach(() => {
    const metadata = getMetadataArgsStorage();
    columnSnapshots = metadata.columns.map((column) => ({
      column,
      type: column.options.type,
      length: column.options.length,
      precision: column.options.precision,
      scale: column.options.scale,
      transformer: column.options.transformer,
    }));
    tableSnapshots = metadata.tables.map((table) => ({ table, schema: table.schema }));
  });

  afterEach(() => {
    for (const snapshot of columnSnapshots) {
      snapshot.column.options.type = snapshot.type;
      snapshot.column.options.length = snapshot.length;
      snapshot.column.options.precision = snapshot.precision;
      snapshot.column.options.scale = snapshot.scale;
      snapshot.column.options.transformer = snapshot.transformer;
    }

    for (const snapshot of tableSnapshots) {
      snapshot.table.schema = snapshot.schema;
    }
  });

  it('maps shared main schema entities to configured Oracle schema', () => {
    new OracleAdapter();

    const metadata = getMetadataArgsStorage();
    const usersTable = metadata.tables.find((table) => table.name === 'users');
    const permissionGrantsTable = metadata.tables.find((table) => table.name === 'permission_grants');

    expect(usersTable?.schema).toBe('ENTERPRISEGLUE');
    expect(permissionGrantsTable?.schema).toBe('ENTERPRISEGLUE');
  });

  it('maps text columns to Oracle-safe varchar2 lengths including composite-unique columns', () => {
    new OracleAdapter();

    const metadata = getMetadataArgsStorage();
    const idColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'AppBaseEntity' && column.propertyName === 'id'
    );
    const permissionColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'PermissionGrant' && column.propertyName === 'permission'
    );
    const resourceTypeColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'PermissionGrant' && column.propertyName === 'resourceType'
    );
    const grantedByColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'PermissionGrant' && column.propertyName === 'grantedById'
    );

    expect(idColumn?.options.type).toBe('varchar2');
    expect(idColumn?.options.length).toBe(191);

    expect(permissionColumn?.options.type).toBe('varchar2');
    expect(permissionColumn?.options.length).toBe(191);

    // Covered by @Unique(['userId', 'permission', 'resourceType', 'resourceId'])
    expect(resourceTypeColumn?.options.type).toBe('varchar2');
    expect(resourceTypeColumn?.options.length).toBe(191);

    // Not indexed/unique -> should remain wide for content
    expect(grantedByColumn?.options.type).toBe('varchar2');
    expect(grantedByColumn?.options.length).toBe(4000);
  });

  it('maps boolean and bigint columns to Oracle number types with safe options', () => {
    new OracleAdapter();

    const metadata = getMetadataArgsStorage();
    const isActiveColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'User' && column.propertyName === 'isActive'
    );
    const createdAtColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'User' && column.propertyName === 'createdAt'
    );
    const transformer = Array.isArray(isActiveColumn?.options.transformer)
      ? isActiveColumn?.options.transformer[0]
      : isActiveColumn?.options.transformer;

    expect(isActiveColumn?.options.type).toBe('number');
    expect(typeof transformer?.to).toBe('function');
    expect(typeof transformer?.from).toBe('function');
    expect(transformer?.to(true)).toBe(1);
    expect(transformer?.from(0)).toBe(false);

    expect(createdAtColumn?.options.type).toBe('number');
    expect(createdAtColumn?.options.precision).toBe(19);
    expect(createdAtColumn?.options.scale).toBe(0);
  });
});
