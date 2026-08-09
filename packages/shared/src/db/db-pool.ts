/**
 * Database Connection Pool
 * 
 * Legacy raw-SQL connection pool abstraction.
 *
 * New code and enterprise plugins must use the portable TypeORM context. This
 * compatibility API remains available only for PostgreSQL and Oracle because
 * raw SQL and parameter syntax cannot be portable across all five adapters.
 */

import pg from 'pg';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getAdapter } from './adapters/index.js';

const { Pool } = pg;

/**
 * Abstract connection pool interface
 * All database pools must implement this interface
 */
export interface ConnectionPool {
  /**
   * Execute a raw SQL query
   * @param sql - SQL query string (placeholder syntax is driver-specific)
   * @param params - Query parameters (typically positional array; some drivers may support named binds)
   */
  query<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<{ rows: T[]; rowCount: number }>;

  /**
   * Close the connection pool
   */
  close(): Promise<void>;

  /**
   * Get the underlying native pool (for advanced use cases)
   */
  getNativePool(): any;
}

/**
 * PostgreSQL Connection Pool Implementation
 */
class PostgresConnectionPool implements ConnectionPool {
  private pool: pg.Pool;

  constructor() {
    if (!config.postgresUrl && (!config.postgresHost || !config.postgresDatabase)) {
      throw new Error('PostgreSQL configuration is missing. Set either POSTGRES_URL or POSTGRES_HOST + POSTGRES_DATABASE in .env');
    }

    const schema = config.postgresSchema;
    const sslOption = config.postgresSsl ? { rejectUnauthorized: config.postgresSslRejectUnauthorized } : false;

    this.pool = new Pool(
      config.postgresUrl
        ? {
            connectionString: config.postgresUrl,
            ssl: sslOption,
            options: `-c search_path=${schema}`,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
          }
        : {
            host: config.postgresHost,
            port: config.postgresPort || 5432,
            user: config.postgresUser,
            password: config.postgresPassword,
            database: config.postgresDatabase,
            ssl: sslOption,
            options: `-c search_path=${schema}`,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
          }
    );

    this.pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });

    console.log('✅ PostgreSQL connection pool created');
  }

  async query<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<{ rows: T[]; rowCount: number }> {
    // PostgreSQL uses $1, $2, etc. for positional parameters
    const result = await this.pool.query(sql, Array.isArray(params) ? params : undefined);
    return { rows: result.rows as T[], rowCount: result.rowCount || 0 };
  }

  async close(): Promise<void> {
    await this.pool.end();
    console.log('✅ PostgreSQL connection pool closed');
  }

  getNativePool(): pg.Pool {
    return this.pool;
  }
}

/**
 * Oracle Connection Pool Implementation
 * Uses oracledb when available
 */
class OracleConnectionPool implements ConnectionPool {
  private pool: any = null;
  private oracledb: any = null;

  constructor() {
    // Oracle connection will be initialized lazily when first used
    console.log('✅ Oracle connection pool ready (lazy init)');
  }

  private async ensurePool(): Promise<void> {
    if (this.pool) {
      return;
    }

    let oracledbModule: any;
    try {
      oracledbModule = await import('oracledb');
    } catch {
      throw new Error(
        'Oracle driver (oracledb) not installed. Install with: pnpm add oracledb ' +
          'and configure Oracle Instant Client: https://oracle.github.io/node-oracledb/INSTALL.html'
      );
    }

    this.oracledb = oracledbModule?.default ?? oracledbModule;

    const connectString = config.oracleConnectionString
      || (config.oracleServiceName
        ? `${config.oracleHost}:${config.oraclePort || 1521}/${config.oracleServiceName}`
        : `${config.oracleHost}:${config.oraclePort || 1521}:${config.oracleSid}`);

    this.pool = await this.oracledb.createPool({
      user: config.oracleUser,
      password: config.oraclePassword,
      connectString,
      poolMin: 1,
      poolMax: 10,
      poolIncrement: 1,
    });

    console.log('✅ Oracle connection pool created');
  }

  async query<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<{ rows: T[]; rowCount: number }> {
    await this.ensurePool();
    const connection = await this.pool.getConnection();
    try {
      const bindings = params ?? [];
      const result = await connection.execute(sql, bindings, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
      });
      return { rows: (result.rows || []) as T[], rowCount: result.rowsAffected || 0 };
    } finally {
      await connection.close();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      console.log('✅ Oracle connection pool closed');
    }
  }

  getNativePool(): any {
    return this.pool;
  }
}

// Singleton pool instance
let poolInstance: ConnectionPool | null = null;

/**
 * Get the database connection pool
 * Returns a singleton instance based on configured database type
 */
export function getConnectionPool(): ConnectionPool {
  if (!poolInstance) {
    const adapter = getAdapter();
    const dbType = adapter.getDatabaseType();

    if (dbType === 'postgres') {
      poolInstance = new PostgresConnectionPool();
    } else if (dbType === 'oracle') {
      poolInstance = new OracleConnectionPool();
    } else {
      throw new Error(
        `ConnectionPool raw SQL adapter is not implemented for DATABASE_TYPE=${dbType} in OSS. ` +
        'Use TypeORM data-source/repository APIs only, or implement the non-Postgres pool before enabling raw-SQL-dependent plugins.'
      );
    }
  }

  return poolInstance;
}

/**
 * Close the database connection pool
 */
export async function closeConnectionPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.close();
    poolInstance = null;
  }
}

/**
 * Preserve the published enterprise-plugin context without constructing a raw
 * driver during ordinary OSS startup. PostgreSQL/Oracle plugins keep their
 * existing behavior; unsupported raw-SQL adapters fail only if a plugin
 * actually calls the legacy pool instead of the portable TypeORM APIs.
 */
export function createLazyConnectionPool(
  resolvePool: () => ConnectionPool = getConnectionPool,
  closePool: () => Promise<void> = closeConnectionPool,
): ConnectionPool {
  return {
    query<T = any>(sql: string, params?: any[] | Record<string, any>) {
      return resolvePool().query<T>(sql, params);
    },
    close() {
      return closePool();
    },
    getNativePool() {
      return resolvePool().getNativePool();
    },
  };
}
