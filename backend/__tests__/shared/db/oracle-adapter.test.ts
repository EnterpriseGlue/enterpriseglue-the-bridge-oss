import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { OracleAdapter } from '@enterpriseglue/shared/db/adapters/OracleAdapter.js';

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
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
  default: any;
};

type TableSnapshot = {
  table: any;
  schema: any;
};

describe('OracleAdapter metadata normalization', () => {
  let columnSnapshots: ColumnSnapshot[] = [];
  let tableSnapshots: TableSnapshot[] = [];
  let indexSnapshots: any[] = [];

  beforeEach(() => {
    const metadata = getMetadataArgsStorage();
    columnSnapshots = metadata.columns.map((column) => ({
      column,
      type: column.options.type,
      length: column.options.length,
      precision: column.options.precision,
      scale: column.options.scale,
      transformer: column.options.transformer,
      default: column.options.default,
    }));
    tableSnapshots = metadata.tables.map((table) => ({ table, schema: table.schema }));
    indexSnapshots = [...metadata.indices];
  });

  afterEach(() => {
    for (const snapshot of columnSnapshots) {
      snapshot.column.options.type = snapshot.type;
      snapshot.column.options.length = snapshot.length;
      snapshot.column.options.precision = snapshot.precision;
      snapshot.column.options.scale = snapshot.scale;
      snapshot.column.options.transformer = snapshot.transformer;
      snapshot.column.options.default = snapshot.default;
    }

    for (const snapshot of tableSnapshots) {
      snapshot.table.schema = snapshot.schema;
    }

    const metadata = getMetadataArgsStorage();
    metadata.indices.splice(0, metadata.indices.length, ...indexSnapshots);
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
    const engineHealthCheckedAtColumn = metadata.columns.find(
      (column) => (column.target as any)?.name === 'EngineHealth' && column.propertyName === 'checkedAt'
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

    const healthTransformer = Array.isArray(engineHealthCheckedAtColumn?.options.transformer)
      ? engineHealthCheckedAtColumn?.options.transformer[0]
      : engineHealthCheckedAtColumn?.options.transformer;
    expect(engineHealthCheckedAtColumn?.options.type).toBe('number');
    expect(healthTransformer?.from('1700000000000')).toBe(1700000000000);
  });

  it('uses CLOB for bounded native-grant and backstop evidence instead of Oracle display-text length', () => {
    new OracleAdapter();
    const metadata = getMetadataArgsStorage();
    for (const entity of ['CamundaNativeGrantImportRun', 'EngineBackstopSyncRun']) {
      for (const propertyName of ['classificationsJson', 'encryptedDetailedSnapshot']) {
        const column = metadata.columns.find((candidate) => (candidate.target as any)?.name === entity
          && candidate.propertyName === propertyName);
        expect(column?.options.type).toBe('clob');
      }
    }
  });

  it('round-trips the logical empty runtime tenant through an Oracle-safe sentinel', () => {
    new OracleAdapter();

    const runtimeTenantColumn = getMetadataArgsStorage().columns.find(
      (column) => (column.target as any)?.name === 'RuntimeResource'
        && column.propertyName === 'runtimeTenantId',
    );
    const transformer = Array.isArray(runtimeTenantColumn?.options.transformer)
      ? runtimeTenantColumn?.options.transformer[0]
      : runtimeTenantColumn?.options.transformer;

    expect(runtimeTenantColumn?.options.default).toBe('__enterpriseglue_default_tenant__');
    expect(transformer?.to('')).toBe('__enterpriseglue_default_tenant__');
    expect(transformer?.from('__enterpriseglue_default_tenant__')).toBe('');
    expect(transformer?.to('runtime-tenant-a')).toBe('runtime-tenant-a');
    expect(transformer?.from('runtime-tenant-a')).toBe('runtime-tenant-a');
  });

  it('round-trips an empty external tenant mapping through an Oracle-safe sentinel', () => {
    new OracleAdapter();

    const externalTenantColumn = getMetadataArgsStorage().columns.find(
      (column) => (column.target as any)?.name === 'EngineTenantMapping'
        && column.propertyName === 'externalTenantId',
    );
    const transformer = Array.isArray(externalTenantColumn?.options.transformer)
      ? externalTenantColumn?.options.transformer[0]
      : externalTenantColumn?.options.transformer;

    expect(externalTenantColumn?.options.default).toBe('__enterpriseglue_empty__');
    expect(transformer?.to('')).toBe('__enterpriseglue_empty__');
    expect(transformer?.from('__enterpriseglue_empty__')).toBe('');
  });
});
