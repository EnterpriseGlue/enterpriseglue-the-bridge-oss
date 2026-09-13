import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

const controlledEnvironment = [
  'NODE_ENV',
  'DATABASE_TYPE',
  'EG_DATABASE_STARTUP_MODE',
  'EG_TENANCY_MODE',
  'EG_TENANT_RLS_ENFORCED',
  'POSTGRES_URL',
  'POSTGRES_SCHEMA',
  'JWT_SECRET',
  'ADMIN_PASSWORD',
  'ENCRYPTION_KEY',
] as const;
const originalEnvironment = new Map(controlledEnvironment.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of controlledEnvironment) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('database-only migration configuration', () => {
  it('loads the production migration module graph without application secrets', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_TYPE = 'postgres';
    process.env.EG_DATABASE_STARTUP_MODE = 'verify';
    process.env.EG_TENANCY_MODE = 'pooled';
    process.env.EG_TENANT_RLS_ENFORCED = 'true';
    process.env.POSTGRES_URL = 'postgresql://owner:password@database.internal:5432/enterpriseglue?schema=main';
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
    vi.resetModules();
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`Unexpected process.exit(${code}) while importing the migration boundary`);
    }) as never);

    const migrations = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { databaseConfig } = await import('@enterpriseglue/shared/config/database.js');

    expect(exit).not.toHaveBeenCalled();
    expect(migrations).toMatchObject({
      runMigrations: expect.any(Function),
      runSchemaEpochOwnerMigrations: expect.any(Function),
      runSchemaEpochPreflight: expect.any(Function),
    });
    expect(databaseConfig).toMatchObject({
      nodeEnv: 'production',
      databaseType: 'postgres',
      databaseStartupMode: 'verify',
      tenancyMode: 'pooled',
    });
    expect(databaseConfig).not.toHaveProperty('jwtSecret');
    expect(databaseConfig).not.toHaveProperty('adminPassword');
    expect(databaseConfig).not.toHaveProperty('encryptionKey');
  });

  it('preserves adapter-specific settings without accepting application secrets', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { loadDatabaseConfig } = await import('@enterpriseglue/shared/config/database.js');

    const postgres = loadDatabaseConfig({
      NODE_ENV: 'production',
      DATABASE_TYPE: 'postgres',
      POSTGRES_URL: 'postgresql://owner:p%40ss@database.internal:5433/enterpriseglue?schema=tenant_data',
      POSTGRES_SSL: 'true',
      POSTGRES_SSL_REJECT_UNAUTHORIZED: 'true',
      JWT_SECRET: 'must-be-ignored',
    });
    expect(postgres).toMatchObject({
      databaseType: 'postgres',
      postgresHost: 'database.internal',
      postgresPort: 5433,
      postgresUser: 'owner',
      postgresPassword: 'p@ss',
      postgresDatabase: 'enterpriseglue',
      postgresSchema: 'tenant_data',
      postgresSsl: true,
      postgresSslRejectUnauthorized: true,
    });
    expect(postgres).not.toHaveProperty('jwtSecret');

    expect(loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'mysql', MYSQL_HOST: 'mysql.internal',
      MYSQL_USER: 'owner', MYSQL_PASSWORD: 'password', MYSQL_DATABASE: 'enterpriseglue',
    })).toMatchObject({ databaseType: 'mysql', mysqlHost: 'mysql.internal', mysqlPort: 3306 });
    expect(loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'mssql', MSSQL_HOST: 'sqlserver.internal',
      MSSQL_USER: 'owner', MSSQL_PASSWORD: 'password', MSSQL_DATABASE: 'enterpriseglue',
    })).toMatchObject({ databaseType: 'mssql', mssqlHost: 'sqlserver.internal', mssqlPort: 1433 });
    expect(loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'oracle', ORACLE_HOST: 'oracle.internal',
      ORACLE_USER: 'owner', ORACLE_PASSWORD: 'password', ORACLE_SERVICE_NAME: 'XEPDB1',
    })).toMatchObject({ databaseType: 'oracle', oracleHost: 'oracle.internal', oraclePort: 1521 });
    expect(loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'oracle',
      ORACLE_CONNECTION_STRING: 'oracle.internal:1521/XEPDB1',
      ORACLE_USER: 'owner', ORACLE_PASSWORD: 'password',
    })).toMatchObject({
      databaseType: 'oracle', oracleConnectionString: 'oracle.internal:1521/XEPDB1',
    });
    expect(loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'spanner', SPANNER_PROJECT_ID: 'project-a',
      SPANNER_INSTANCE_ID: 'instance-a', SPANNER_DATABASE_ID: 'enterpriseglue',
    })).toMatchObject({ databaseType: 'spanner', spannerProjectId: 'project-a' });
  });

  it('fails closed for incomplete adapter configuration and the public Postgres schema', async () => {
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const { loadDatabaseConfig } = await import('@enterpriseglue/shared/config/database.js');

    const postgresFields: NodeJS.ProcessEnv = {
      NODE_ENV: 'production', DATABASE_TYPE: 'postgres', POSTGRES_SCHEMA: 'main',
      POSTGRES_HOST: 'postgres.internal', POSTGRES_USER: 'owner',
      POSTGRES_PASSWORD: 'password', POSTGRES_DATABASE: 'enterpriseglue',
    };
    for (const name of ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE']) {
      const environment = { ...postgresFields };
      delete environment[name];
      expect(() => loadDatabaseConfig(environment)).toThrow(
        `${name} is required when DATABASE_TYPE=postgres.`,
      );
    }
    expect(() => loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'postgres',
      POSTGRES_URL: 'postgresql://owner:password@postgres.internal/enterpriseglue?schema=public',
    })).toThrow(
      'Schema mode requires POSTGRES_SCHEMA to be set to a non-public schema name when DATABASE_TYPE=postgres.',
    );

    const oracleConnection: NodeJS.ProcessEnv = {
      NODE_ENV: 'production', DATABASE_TYPE: 'oracle',
      ORACLE_CONNECTION_STRING: 'oracle.internal:1521/XEPDB1',
      ORACLE_USER: 'owner', ORACLE_PASSWORD: 'password',
    };
    for (const name of ['ORACLE_USER', 'ORACLE_PASSWORD']) {
      const environment = { ...oracleConnection };
      delete environment[name];
      expect(() => loadDatabaseConfig(environment)).toThrow(
        `${name} is required when DATABASE_TYPE=oracle.`,
      );
    }
    expect(() => loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'oracle',
      ORACLE_USER: 'owner', ORACLE_PASSWORD: 'password', ORACLE_SERVICE_NAME: 'XEPDB1',
    })).toThrow('ORACLE_HOST is required when DATABASE_TYPE=oracle.');
    expect(() => loadDatabaseConfig({
      NODE_ENV: 'production', DATABASE_TYPE: 'oracle', ORACLE_HOST: 'oracle.internal',
      ORACLE_USER: 'owner', ORACLE_PASSWORD: 'password',
    })).toThrow(
      'Either ORACLE_SERVICE_NAME, ORACLE_SID, or ORACLE_CONNECTION_STRING is required when DATABASE_TYPE=oracle.',
    );

    const requiredFields = [
      {
        databaseType: 'mssql',
        environment: {
          MSSQL_HOST: 'sqlserver.internal', MSSQL_USER: 'owner',
          MSSQL_PASSWORD: 'password', MSSQL_DATABASE: 'enterpriseglue',
        },
      },
      {
        databaseType: 'mysql',
        environment: {
          MYSQL_HOST: 'mysql.internal', MYSQL_USER: 'owner',
          MYSQL_PASSWORD: 'password', MYSQL_DATABASE: 'enterpriseglue',
        },
      },
      {
        databaseType: 'spanner',
        environment: {
          SPANNER_PROJECT_ID: 'project-a', SPANNER_INSTANCE_ID: 'instance-a',
          SPANNER_DATABASE_ID: 'enterpriseglue',
        },
      },
    ] as const;
    for (const adapter of requiredFields) {
      for (const name of Object.keys(adapter.environment)) {
        const environment: NodeJS.ProcessEnv = {
          NODE_ENV: 'production', DATABASE_TYPE: adapter.databaseType, ...adapter.environment,
        };
        delete environment[name];
        expect(() => loadDatabaseConfig(environment)).toThrow(
          `${name} is required when DATABASE_TYPE=${adapter.databaseType}.`,
        );
      }
    }
  });

  it('keeps pooled tenancy database validation at the migration boundary', async () => {
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const { loadDatabaseConfig } = await import('@enterpriseglue/shared/config/database.js');

    expect(() => loadDatabaseConfig({
      NODE_ENV: 'production',
      DATABASE_TYPE: 'mysql',
      EG_TENANCY_MODE: 'pooled',
      EG_TENANT_RLS_ENFORCED: 'true',
    })).toThrow('EG_TENANCY_MODE=pooled requires DATABASE_TYPE=postgres.');
    expect(() => loadDatabaseConfig({
      NODE_ENV: 'production',
      DATABASE_TYPE: 'postgres',
      EG_TENANCY_MODE: 'pooled',
      EG_TENANT_RLS_ENFORCED: 'false',
    })).toThrow('EG_TENANCY_MODE=pooled requires EG_TENANT_RLS_ENFORCED=true');
  });

  it('shares database state with the full application config without weakening app validation', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_TYPE = 'postgres';
    process.env.EG_TENANCY_MODE = 'single';
    process.env.POSTGRES_URL = 'postgresql://owner:password@database.internal:5432/enterpriseglue?schema=main';
    vi.resetModules();

    const database = await import('@enterpriseglue/shared/config/database.js');
    const application = await import('@enterpriseglue/shared/config/index.js');

    expect(application.config).toBe(database.databaseConfig);
    application.config.tenancyMode = 'pooled';
    expect(database.databaseConfig.tenancyMode).toBe('pooled');
  });
});
