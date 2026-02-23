import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  nodeEnv: 'test' as const,
  postgresSchema: 'main',
  postgresSsl: false,
  postgresSslRejectUnauthorized: false as boolean,
  postgresUrl: undefined as string | undefined,
  postgresHost: undefined as string | undefined,
  postgresPort: undefined as number | undefined,
  postgresUser: undefined as string | undefined,
  postgresPassword: undefined as string | undefined,
  postgresDatabase: undefined as string | undefined,
}));

vi.mock('@shared/config/index.js', () => ({ config: mockConfig }));

import { PostgresAdapter } from '../../../src/shared/db/adapters/PostgresAdapter.js';

beforeEach(() => {
  mockConfig.postgresSsl = false;
  mockConfig.postgresSslRejectUnauthorized = false;
  mockConfig.postgresUrl = undefined;
  mockConfig.postgresHost = undefined;
  mockConfig.postgresPort = undefined;
  mockConfig.postgresUser = undefined;
  mockConfig.postgresPassword = undefined;
  mockConfig.postgresDatabase = undefined;
});

describe('PostgresAdapter.getDataSourceOptions — POSTGRES_URL (connection string mode)', () => {
  it('uses url and omits individual host fields when postgresUrl is set', () => {
    mockConfig.postgresUrl = 'postgresql://user:pass@db.example.com:5432/mydb?schema=main';

    const opts = new PostgresAdapter().getDataSourceOptions() as any;

    expect(opts.url).toBe('postgresql://user:pass@db.example.com:5432/mydb?schema=main');
    expect(opts.host).toBeUndefined();
    expect(opts.username).toBeUndefined();
    expect(opts.password).toBeUndefined();
    expect(opts.database).toBeUndefined();
    expect(opts.type).toBe('postgres');
  });

  it('passes managed DB URL with sslmode query param through unchanged', () => {
    mockConfig.postgresUrl = 'postgresql://admin:secret@rds.amazonaws.com:5432/prod?schema=main&sslmode=require';

    const opts = new PostgresAdapter().getDataSourceOptions() as any;

    expect(opts.url).toContain('rds.amazonaws.com');
    expect(opts.url).toContain('sslmode=require');
    expect(opts.host).toBeUndefined();
  });

  it('preserves schema and ssl config alongside the url', () => {
    mockConfig.postgresUrl = 'postgresql://user:pass@host:5432/db';
    mockConfig.postgresSsl = true;
    mockConfig.postgresSslRejectUnauthorized = true;

    const opts = new PostgresAdapter().getDataSourceOptions() as any;

    expect(opts.schema).toBe('main');
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
  });
});

describe('PostgresAdapter.getDataSourceOptions — individual vars (no POSTGRES_URL)', () => {
  it('uses host/port/username/password/database when postgresUrl is not set', () => {
    mockConfig.postgresHost = 'db.internal';
    mockConfig.postgresPort = 5432;
    mockConfig.postgresUser = 'enterpriseglue';
    mockConfig.postgresPassword = 'secret';
    mockConfig.postgresDatabase = 'enterpriseglue';

    const opts = new PostgresAdapter().getDataSourceOptions() as any;

    expect(opts.url).toBeUndefined();
    expect(opts.host).toBe('db.internal');
    expect(opts.port).toBe(5432);
    expect(opts.username).toBe('enterpriseglue');
    expect(opts.password).toBe('secret');
    expect(opts.database).toBe('enterpriseglue');
    expect(opts.type).toBe('postgres');
  });

  it('omits ssl when postgresSsl is false', () => {
    mockConfig.postgresHost = 'db.internal';
    mockConfig.postgresSsl = false;

    const opts = new PostgresAdapter().getDataSourceOptions() as any;

    expect(opts.ssl).toBeUndefined();
  });
});
