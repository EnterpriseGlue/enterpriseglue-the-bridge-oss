import { z } from 'zod';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load .env file FIRST before reading any environment variables
dotenv.config();

/**
 * Application configuration with validation
 * Validates environment variables on startup and provides type-safe access
 */

const schemaName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

 const configSchema = z.object({
  // Server configuration
  port: z.number().int().positive().default(8787),
  
  // Database configuration
  databaseType: z.enum(['postgres', 'oracle', 'mssql', 'spanner', 'mysql']).default('postgres'),
  
  // PostgreSQL configuration (when databaseType=postgres)
  postgresHost: z.string().optional(),
  postgresPort: z.number().int().positive().optional(),
  postgresUser: z.string().optional(),
  postgresPassword: z.string().optional(),
  postgresDatabase: z.string().optional(),
  postgresSchema: schemaName.default('public'),
  postgresSsl: z.boolean().default(false),

  // Oracle configuration (when databaseType=oracle)
  oracleHost: z.string().optional(),
  oraclePort: z.number().int().positive().default(1521),
  oracleUser: z.string().optional(),
  oraclePassword: z.string().optional(),
  oracleServiceName: z.string().optional(),
  oracleSid: z.string().optional(),
  oracleSchema: schemaName.default('MAIN'),

  // SQL Server configuration (when databaseType=mssql)
  mssqlHost: z.string().optional(),
  mssqlPort: z.number().int().positive().default(1433),
  mssqlUser: z.string().optional(),
  mssqlPassword: z.string().optional(),
  mssqlDatabase: z.string().optional(),
  mssqlSchema: schemaName.default('dbo'),
  mssqlEncrypt: z.boolean().default(true),
  mssqlTrustServerCertificate: z.boolean().default(false),

  // Google Spanner configuration (when databaseType=spanner)
  spannerProjectId: z.string().optional(),
  spannerInstanceId: z.string().optional(),
  spannerDatabaseId: z.string().optional(),

  // MySQL configuration (when databaseType=mysql)
  mysqlHost: z.string().optional(),
  mysqlPort: z.number().int().positive().default(3306),
  mysqlUser: z.string().optional(),
  mysqlPassword: z.string().optional(),
  mysqlDatabase: z.string().optional(),

  enterpriseSchema: schemaName.default('enterprise'),
  
  // Authentication configuration
  jwtSecret: z.string().min(32),
  jwtAccessTokenExpires: z.number().int().positive().default(900), // 15 minutes in seconds
  jwtRefreshTokenExpires: z.number().int().positive().default(604800), // 7 days in seconds
  
  // Admin bootstrap configuration
  adminEmail: z.string().email().default('admin@example.com'),
  adminPassword: z.string().min(8),
  
  // Email configuration (Resend)
  resendApiKey: z.string().optional(),
  frontendUrl: z.string().url().default('http://localhost:5173'),
  
  // Camunda configuration (optional - can use persisted engines instead)
  camundaBaseUrl: z.string().url().optional(),
  camundaUsername: z.string().optional(),
  camundaPassword: z.string().optional(),
  
  // Microsoft Entra ID (Azure AD) configuration
  microsoftClientId: z.string().optional(),
  microsoftClientSecret: z.string().optional(),
  microsoftTenantId: z.string().optional(),
  microsoftRedirectUri: z.string().url().optional(),
  
  // Google OAuth configuration
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
  googleRedirectUri: z.string().url().optional(),
  
  // Environment
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  multiTenant: z.boolean().default(false),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const inferredNodeEnv = (process.env.NODE_ENV as any) || 'development';
  const generatedJwtSecret = inferredNodeEnv === 'production'
    ? undefined
    : crypto.randomBytes(48).toString('hex');
  const generatedAdminPassword = inferredNodeEnv === 'production'
    ? undefined
    : crypto.randomBytes(18).toString('base64url');

  const raw = {
    port: process.env.API_PORT ? Number(process.env.API_PORT) : undefined,
    databaseType: process.env.DATABASE_TYPE,
    postgresHost: process.env.POSTGRES_HOST,
    postgresPort: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : undefined,
    postgresUser: process.env.POSTGRES_USER,
    postgresPassword: process.env.POSTGRES_PASSWORD,
    postgresDatabase: process.env.POSTGRES_DATABASE,
    postgresSchema: process.env.POSTGRES_SCHEMA,
    postgresSsl: process.env.POSTGRES_SSL === 'true',
    oracleHost: process.env.ORACLE_HOST,
    oraclePort: process.env.ORACLE_PORT ? Number(process.env.ORACLE_PORT) : undefined,
    oracleUser: process.env.ORACLE_USER,
    oraclePassword: process.env.ORACLE_PASSWORD,
    oracleServiceName: process.env.ORACLE_SERVICE_NAME,
    oracleSid: process.env.ORACLE_SID,
    oracleSchema: process.env.ORACLE_SCHEMA,
    mssqlHost: process.env.MSSQL_HOST,
    mssqlPort: process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : undefined,
    mssqlUser: process.env.MSSQL_USER,
    mssqlPassword: process.env.MSSQL_PASSWORD,
    mssqlDatabase: process.env.MSSQL_DATABASE,
    mssqlSchema: process.env.MSSQL_SCHEMA,
    mssqlEncrypt: process.env.MSSQL_ENCRYPT === 'true',
    mssqlTrustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE === 'true',
    spannerProjectId: process.env.SPANNER_PROJECT_ID,
    spannerInstanceId: process.env.SPANNER_INSTANCE_ID,
    spannerDatabaseId: process.env.SPANNER_DATABASE_ID,
    mysqlHost: process.env.MYSQL_HOST,
    mysqlPort: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : undefined,
    mysqlUser: process.env.MYSQL_USER,
    mysqlPassword: process.env.MYSQL_PASSWORD,
    mysqlDatabase: process.env.MYSQL_DATABASE,

    enterpriseSchema: process.env.ENTERPRISE_SCHEMA || process.env.ENTERPRISE_POSTGRES_SCHEMA, // ENTERPRISE_POSTGRES_SCHEMA is deprecated
    jwtSecret: process.env.JWT_SECRET || generatedJwtSecret,
    jwtAccessTokenExpires: process.env.JWT_ACCESS_TOKEN_EXPIRES ? Number(process.env.JWT_ACCESS_TOKEN_EXPIRES) : undefined,
    jwtRefreshTokenExpires: process.env.JWT_REFRESH_TOKEN_EXPIRES ? Number(process.env.JWT_REFRESH_TOKEN_EXPIRES) : undefined,
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD || generatedAdminPassword,
    resendApiKey: process.env.RESEND_API_KEY,
    frontendUrl: process.env.FRONTEND_URL,
    camundaBaseUrl: process.env.CAMUNDA_BASE_URL,
    camundaUsername: process.env.CAMUNDA_USERNAME,
    camundaPassword: process.env.CAMUNDA_PASSWORD,
    microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
    microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    microsoftTenantId: process.env.MICROSOFT_TENANT_ID,
    microsoftRedirectUri: process.env.MICROSOFT_REDIRECT_URI,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    nodeEnv: inferredNodeEnv,

    multiTenant: process.env.MULTI_TENANT === 'true',
  };

  try {
    return configSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

// Singleton config instance
export const config = loadConfig();

const mainSchema = config.postgresSchema;
const enterpriseSchema = config.enterpriseSchema;

if (mainSchema === 'public') {
  throw new Error(
    'Schema mode requires POSTGRES_SCHEMA to be set to a non-public schema name.'
  );
}

if (enterpriseSchema === 'public') {
  throw new Error(
    'Schema mode requires ENTERPRISE_SCHEMA to be set to a non-public schema name.'
  );
}

if (enterpriseSchema === mainSchema) {
  throw new Error(
    'Schema mode requires ENTERPRISE_SCHEMA to be distinct from the main schema.'
  );
}

// Log configuration on startup (excluding sensitive data)
console.log('✅ Configuration loaded:');
console.log(`  - Port: ${config.port}`);
console.log(`  - Database Type: ${config.databaseType}`);
if (config.databaseType === 'postgres') {
  console.log(`  - PostgreSQL Host: ${config.postgresHost}`);
  console.log(`  - PostgreSQL Database: ${config.postgresDatabase}`);
} else if (config.databaseType === 'oracle') {
  console.log(`  - Oracle Host: ${config.oracleHost}`);
  console.log(`  - Oracle Service: ${config.oracleServiceName || config.oracleSid}`);
} else if (config.databaseType === 'mssql') {
  console.log(`  - SQL Server Host: ${config.mssqlHost}`);
  console.log(`  - SQL Server Database: ${config.mssqlDatabase}`);
} else if (config.databaseType === 'spanner') {
  console.log(`  - Spanner Project: ${config.spannerProjectId}`);
  console.log(`  - Spanner Instance: ${config.spannerInstanceId}`);
  console.log(`  - Spanner Database: ${config.spannerDatabaseId}`);
} else if (config.databaseType === 'mysql') {
  console.log(`  - MySQL Host: ${config.mysqlHost}`);
  console.log(`  - MySQL Database: ${config.mysqlDatabase}`);
}
console.log(`  - Environment: ${config.nodeEnv}`);
if (config.nodeEnv === 'development') {
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET not set. Using a generated secret (tokens will be invalid after restart).');
  }
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(`⚠️  ADMIN_PASSWORD not set. A random password has been generated. Check application logs for access.`);
  }
}
if (config.camundaBaseUrl) {
  console.log(`  - Camunda URL: ${config.camundaBaseUrl}`);
}

// Re-export feature flags for convenience
export { features, isFeatureEnabled, logFeatureFlags } from './features.js';
