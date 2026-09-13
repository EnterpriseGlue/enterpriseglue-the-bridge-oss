import { z } from 'zod';
import './load-environment.js';

const schemaName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const databaseConfigSchema = z.object({
  databaseType: z.enum(['postgres', 'oracle', 'mssql', 'spanner', 'mysql']).default('postgres'),
  databaseStartupMode: z.enum(['apply', 'verify']).default('apply'),
  tenancyMode: z.enum(['single', 'pooled']).default('single'),
  tenantRlsEnforced: z.boolean().default(false),

  postgresUrl: z.string().url().optional(),
  postgresHost: z.string().optional(),
  postgresPort: z.number().int().positive().optional(),
  postgresUser: z.string().optional(),
  postgresPassword: z.string().optional(),
  postgresDatabase: z.string().optional(),
  postgresSchema: schemaName.default('public'),
  postgresSsl: z.boolean().default(false),
  postgresSslRejectUnauthorized: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),

  oracleConnectionString: z.string().optional(),
  oracleHost: z.string().optional(),
  oraclePort: z.number().int().positive().default(1521),
  oracleUser: z.string().optional(),
  oraclePassword: z.string().optional(),
  oracleServiceName: z.string().optional(),
  oracleSid: z.string().optional(),
  oracleSchema: schemaName.default('MAIN'),

  mssqlHost: z.string().optional(),
  mssqlPort: z.number().int().positive().default(1433),
  mssqlUser: z.string().optional(),
  mssqlPassword: z.string().optional(),
  mssqlDatabase: z.string().optional(),
  mssqlSchema: schemaName.default('dbo'),
  mssqlEncrypt: z.boolean().default(true),
  mssqlTrustServerCertificate: z.boolean().default(false),

  spannerProjectId: z.string().optional(),
  spannerInstanceId: z.string().optional(),
  spannerDatabaseId: z.string().optional(),

  mysqlHost: z.string().optional(),
  mysqlPort: z.number().int().positive().default(3306),
  mysqlUser: z.string().optional(),
  mysqlPassword: z.string().optional(),
  mysqlDatabase: z.string().optional(),

  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

const optional = (value: string | undefined): string | undefined => {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const requireConfig = (name: string, value: unknown, databaseType: string): void => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${name} is required when DATABASE_TYPE=${databaseType}.`);
  }
};

function validateDatabaseConfig(config: DatabaseConfig): void {
  switch (config.databaseType) {
    case 'postgres': {
      // POSTGRES_URL is the complete connection alternative. Without it, all
      // four discrete connection fields remain mandatory.
      if (!config.postgresUrl) {
        requireConfig('POSTGRES_HOST', config.postgresHost, 'postgres');
        requireConfig('POSTGRES_USER', config.postgresUser, 'postgres');
        requireConfig('POSTGRES_PASSWORD', config.postgresPassword, 'postgres');
        requireConfig('POSTGRES_DATABASE', config.postgresDatabase, 'postgres');
      }
      if (config.postgresSchema === 'public') {
        throw new Error(
          'Schema mode requires POSTGRES_SCHEMA to be set to a non-public schema name when DATABASE_TYPE=postgres.',
        );
      }
      break;
    }
    case 'oracle': {
      requireConfig('ORACLE_USER', config.oracleUser, 'oracle');
      requireConfig('ORACLE_PASSWORD', config.oraclePassword, 'oracle');
      if (!config.oracleConnectionString) {
        requireConfig('ORACLE_HOST', config.oracleHost, 'oracle');
        if (!config.oracleServiceName && !config.oracleSid) {
          throw new Error(
            'Either ORACLE_SERVICE_NAME, ORACLE_SID, or ORACLE_CONNECTION_STRING is required when DATABASE_TYPE=oracle.',
          );
        }
      }
      break;
    }
    case 'mssql': {
      requireConfig('MSSQL_HOST', config.mssqlHost, 'mssql');
      requireConfig('MSSQL_USER', config.mssqlUser, 'mssql');
      requireConfig('MSSQL_PASSWORD', config.mssqlPassword, 'mssql');
      requireConfig('MSSQL_DATABASE', config.mssqlDatabase, 'mssql');
      break;
    }
    case 'mysql': {
      requireConfig('MYSQL_HOST', config.mysqlHost, 'mysql');
      requireConfig('MYSQL_USER', config.mysqlUser, 'mysql');
      requireConfig('MYSQL_PASSWORD', config.mysqlPassword, 'mysql');
      requireConfig('MYSQL_DATABASE', config.mysqlDatabase, 'mysql');
      break;
    }
    case 'spanner': {
      requireConfig('SPANNER_PROJECT_ID', config.spannerProjectId, 'spanner');
      requireConfig('SPANNER_INSTANCE_ID', config.spannerInstanceId, 'spanner');
      requireConfig('SPANNER_DATABASE_ID', config.spannerDatabaseId, 'spanner');
      break;
    }
  }
}

/**
 * Parse only settings needed to connect, migrate, verify, and enforce the
 * database tenancy boundary. Application authentication, administrator,
 * encryption, email, engine, and cloud-control settings are intentionally not
 * represented here.
 */
export function loadDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  let postgresUrl: URL | null = null;
  if (environment.POSTGRES_URL) {
    try { postgresUrl = new URL(environment.POSTGRES_URL); } catch { /* Zod reports the invalid URL below. */ }
  }

  const parsed = databaseConfigSchema.parse({
    databaseType: environment.DATABASE_TYPE,
    databaseStartupMode: optional(environment.EG_DATABASE_STARTUP_MODE),
    tenancyMode: optional(environment.EG_TENANCY_MODE),
    tenantRlsEnforced: environment.EG_TENANT_RLS_ENFORCED === 'true',

    postgresUrl: environment.POSTGRES_URL,
    postgresHost: environment.POSTGRES_HOST || postgresUrl?.hostname || undefined,
    postgresPort: environment.POSTGRES_PORT
      ? Number(environment.POSTGRES_PORT)
      : postgresUrl?.port ? Number(postgresUrl.port) : undefined,
    postgresUser: environment.POSTGRES_USER || (postgresUrl?.username ? decodeURIComponent(postgresUrl.username) : undefined),
    postgresPassword: environment.POSTGRES_PASSWORD || (postgresUrl?.password ? decodeURIComponent(postgresUrl.password) : undefined),
    postgresDatabase: environment.POSTGRES_DATABASE || (postgresUrl?.pathname ? postgresUrl.pathname.replace(/^\//, '') : undefined),
    postgresSchema: optional(environment.POSTGRES_SCHEMA || postgresUrl?.searchParams.get('schema') || undefined),
    postgresSsl: environment.POSTGRES_SSL === 'true',
    postgresSslRejectUnauthorized: environment.POSTGRES_SSL_REJECT_UNAUTHORIZED,

    oracleConnectionString: optional(environment.ORACLE_CONNECTION_STRING),
    oracleHost: environment.ORACLE_HOST,
    oraclePort: environment.ORACLE_PORT ? Number(environment.ORACLE_PORT) : undefined,
    oracleUser: environment.ORACLE_USER,
    oraclePassword: environment.ORACLE_PASSWORD,
    oracleServiceName: environment.ORACLE_SERVICE_NAME,
    oracleSid: environment.ORACLE_SID,
    oracleSchema: optional(environment.ORACLE_SCHEMA),

    mssqlHost: environment.MSSQL_HOST,
    mssqlPort: environment.MSSQL_PORT ? Number(environment.MSSQL_PORT) : undefined,
    mssqlUser: environment.MSSQL_USER,
    mssqlPassword: environment.MSSQL_PASSWORD,
    mssqlDatabase: environment.MSSQL_DATABASE,
    mssqlSchema: optional(environment.MSSQL_SCHEMA),
    mssqlEncrypt: environment.MSSQL_ENCRYPT === 'true',
    mssqlTrustServerCertificate: environment.MSSQL_TRUST_SERVER_CERTIFICATE === 'true',

    spannerProjectId: environment.SPANNER_PROJECT_ID,
    spannerInstanceId: environment.SPANNER_INSTANCE_ID,
    spannerDatabaseId: environment.SPANNER_DATABASE_ID,

    mysqlHost: environment.MYSQL_HOST,
    mysqlPort: environment.MYSQL_PORT ? Number(environment.MYSQL_PORT) : undefined,
    mysqlUser: environment.MYSQL_USER,
    mysqlPassword: environment.MYSQL_PASSWORD,
    mysqlDatabase: environment.MYSQL_DATABASE,

    nodeEnv: environment.NODE_ENV || 'development',
  });

  if (parsed.tenancyMode === 'pooled' && parsed.databaseType !== 'postgres') {
    throw new Error('EG_TENANCY_MODE=pooled requires DATABASE_TYPE=postgres.');
  }
  if (parsed.tenancyMode === 'pooled' && !parsed.tenantRlsEnforced) {
    throw new Error(
      'EG_TENANCY_MODE=pooled requires EG_TENANT_RLS_ENFORCED=true so tenant isolation cannot start without PostgreSQL row policies.',
    );
  }

  validateDatabaseConfig(parsed);

  return parsed;
}

// This object is also the database-shaped base of the full application config.
// Sharing its identity preserves runtime/test updates of tenancy settings while
// allowing migration-only imports to stop before application secret validation.
export const databaseConfig = loadDatabaseConfig();
