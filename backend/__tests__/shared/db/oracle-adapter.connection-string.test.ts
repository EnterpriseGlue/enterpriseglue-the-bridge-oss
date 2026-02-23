import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';

const mockConfig = vi.hoisted(() => ({
  nodeEnv: 'test' as const,
  oracleSchema: 'ENTERPRISEGLUE',
  oracleConnectionString: undefined as string | undefined,
  oracleHost: undefined as string | undefined,
  oraclePort: 1521 as number,
  oracleUser: 'enterpriseglue',
  oraclePassword: 'secret',
  oracleServiceName: undefined as string | undefined,
  oracleSid: undefined as string | undefined,
}));

vi.mock('@shared/config/index.js', () => ({ config: mockConfig }));

import { OracleAdapter } from '../../../src/shared/db/adapters/OracleAdapter.js';

type ColumnSnapshot = { column: any; type: any; length: any; precision: any; scale: any; transformer: any };
type TableSnapshot = { table: any; schema: any };

let columnSnapshots: ColumnSnapshot[] = [];
let tableSnapshots: TableSnapshot[] = [];

beforeEach(() => {
  mockConfig.oracleConnectionString = undefined;
  mockConfig.oracleHost = undefined;
  mockConfig.oraclePort = 1521;
  mockConfig.oracleServiceName = undefined;
  mockConfig.oracleSid = undefined;

  const metadata = getMetadataArgsStorage();
  columnSnapshots = metadata.columns.map((c) => ({
    column: c, type: c.options.type, length: c.options.length,
    precision: c.options.precision, scale: c.options.scale, transformer: c.options.transformer,
  }));
  tableSnapshots = metadata.tables.map((t) => ({ table: t, schema: t.schema }));
});

afterEach(() => {
  for (const s of columnSnapshots) {
    s.column.options.type = s.type;
    s.column.options.length = s.length;
    s.column.options.precision = s.precision;
    s.column.options.scale = s.scale;
    s.column.options.transformer = s.transformer;
  }
  for (const s of tableSnapshots) s.table.schema = s.schema;
});

describe('OracleAdapter.getDataSourceOptions — ORACLE_CONNECTION_STRING (multi-host)', () => {
  it('uses ORACLE_CONNECTION_STRING directly as connectString', () => {
    mockConfig.oracleConnectionString = 'host1.example.com:1521,host2.example.com:1521/MYSERVICE';

    const opts = new OracleAdapter().getDataSourceOptions() as any;

    expect(opts.extra.connectString).toBe('host1.example.com:1521,host2.example.com:1521/MYSERVICE');
    expect(opts.type).toBe('oracle');
  });

  it('uses TNS descriptor as connectString when provided', () => {
    mockConfig.oracleConnectionString =
      '(DESCRIPTION=(FAILOVER=on)(LOAD_BALANCE=on)' +
      '(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=host1)(PORT=1521))' +
      '(ADDRESS=(PROTOCOL=TCP)(HOST=host2)(PORT=1521)))' +
      '(CONNECT_DATA=(SERVICE_NAME=MYSERVICE)))';

    const opts = new OracleAdapter().getDataSourceOptions() as any;

    expect(opts.extra.connectString).toContain('FAILOVER=on');
    expect(opts.extra.connectString).toContain('LOAD_BALANCE=on');
    expect(opts.extra.connectString).toContain('host1');
    expect(opts.extra.connectString).toContain('host2');
  });

  it('does not include individual host/port/serviceName in DataSourceOptions when connection string is set', () => {
    mockConfig.oracleConnectionString = 'host1:1521,host2:1521/SVC';
    mockConfig.oracleHost = 'should-be-ignored';
    mockConfig.oracleServiceName = 'should-be-ignored';

    const opts = new OracleAdapter().getDataSourceOptions() as any;

    expect(opts.host).toBeUndefined();
    expect(opts.port).toBeUndefined();
    expect(opts.serviceName).toBeUndefined();
    expect(opts.extra.connectString).toBe('host1:1521,host2:1521/SVC');
  });
});

describe('OracleAdapter.getDataSourceOptions — individual vars (single host)', () => {
  it('derives connectString from host:port/serviceName when no connection string', () => {
    mockConfig.oracleHost = 'oracle.internal';
    mockConfig.oraclePort = 1521;
    mockConfig.oracleServiceName = 'XEPDB1';

    const opts = new OracleAdapter().getDataSourceOptions() as any;

    expect(opts.extra.connectString).toBe('oracle.internal:1521/XEPDB1');
  });

  it('derives connectString from host:port:SID when serviceName is absent', () => {
    mockConfig.oracleHost = 'oracle.internal';
    mockConfig.oraclePort = 1521;
    mockConfig.oracleSid = 'XE';

    const opts = new OracleAdapter().getDataSourceOptions() as any;

    expect(opts.extra.connectString).toBe('oracle.internal:1521:XE');
  });

  it('always includes username and password regardless of connection mode', () => {
    mockConfig.oracleConnectionString = 'host1:1521,host2:1521/SVC';

    const opts = new OracleAdapter().getDataSourceOptions() as any;

    expect(opts.username).toBe('enterpriseglue');
    expect(opts.password).toBe('secret');
  });
});
