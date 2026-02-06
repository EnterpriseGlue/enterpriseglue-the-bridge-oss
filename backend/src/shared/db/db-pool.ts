/**
 * Database Connection Pool
 * 
 * Provides database-agnostic connection pool abstraction.
 * Supports PostgreSQL, Oracle, MySQL, SQL Server, and Spanner.
 */

import pg from 'pg';
import { config } from '@shared/config/index.js';
import { getAdapter } from './adapters/index.js';

const { Pool } = pg;

/**
 * Abstract connection pool interface
 * All database pools must implement this interface
 */
export interface ConnectionPool {
  /**
   * Execute a raw SQL query
   * @param sql - SQL query string (use :param for named parameters)
   * @param params - Query parameters (array for positional, object for named)
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
    if (!config.postgresHost || !config.postgresDatabase) {
      throw new Error('PostgreSQL configuration is missing. Please set POSTGRES_HOST and POSTGRES_DATABASE in .env');
    }

    const schema = config.postgresSchema;

    this.pool = new Pool({
      host: config.postgresHost,
      port: config.postgresPort || 5432,
      user: config.postgresUser,
      password: config.postgresPassword,
      database: config.postgresDatabase,
      ssl: config.postgresSsl ? { rejectUnauthorized: config.postgresSslRejectUnauthorized } : false,
      options: `-c search_path=${schema}`,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

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
 * Oracle Connection Pool Implementation (placeholder)
 * Uses oracledb when available
 */
class OracleConnectionPool implements ConnectionPool {
  private pool: any = null;

  constructor() {
    // Oracle connection will be initialized lazily when oracledb is available
    console.log('✅ Oracle connection pool placeholder created');
  }

  async query<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<{ rows: T[]; rowCount: number }> {
    // Convert :param style to Oracle bind variables
    // Oracle uses :param for named parameters which is already compatible
    if (!this.pool) {
      throw new Error('Oracle connection pool not initialized. Please install oracledb package.');
    }
    const connection = await this.pool.getConnection();
    try {
      const result = await connection.execute(sql, params || {}, { outFormat: 2 /* OBJECT */ });
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

/**
 * MySQL Connection Pool Implementation (placeholder)
 */
class MySQLConnectionPool implements ConnectionPool {
  private pool: any = null;

  constructor() {
    console.log('✅ MySQL connection pool placeholder created');
  }

  async query<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<{ rows: T[]; rowCount: number }> {
    if (!this.pool) {
      throw new Error('MySQL connection pool not initialized. Please install mysql2 package.');
    }
    const [rows, fields] = await this.pool.execute(sql, params);
    return { rows: rows as T[], rowCount: Array.isArray(rows) ? rows.length : 0 };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      console.log('✅ MySQL connection pool closed');
    }
  }

  getNativePool(): any {
    return this.pool;
  }
}

/**
 * SQL Server Connection Pool Implementation (placeholder)
 */
class SqlServerConnectionPool implements ConnectionPool {
  private pool: any = null;

  constructor() {
    console.log('✅ SQL Server connection pool placeholder created');
  }

  async query<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<{ rows: T[]; rowCount: number }> {
    if (!this.pool) {
      throw new Error('SQL Server connection pool not initialized. Please install mssql package.');
    }
    const result = await this.pool.request().query(sql);
    return { rows: result.recordset as T[], rowCount: result.rowsAffected?.[0] || 0 };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      console.log('✅ SQL Server connection pool closed');
    }
  }

  getNativePool(): any {
    return this.pool;
  }
}

/**
 * Spanner Connection Pool Implementation (placeholder)
 */
class SpannerConnectionPool implements ConnectionPool {
  private database: any = null;

  constructor() {
    console.log('✅ Spanner connection pool placeholder created');
  }

  async query<T = any>(sql: string, params?: any[] | Record<string, any>): Promise<{ rows: T[]; rowCount: number }> {
    if (!this.database) {
      throw new Error('Spanner connection not initialized. Please install @google-cloud/spanner package.');
    }
    const [rows] = await this.database.run({ sql, params });
    return { rows: rows as T[], rowCount: rows.length };
  }

  async close(): Promise<void> {
    if (this.database) {
      await this.database.close();
      console.log('✅ Spanner connection closed');
    }
  }

  getNativePool(): any {
    return this.database;
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

    switch (dbType) {
      case 'oracle':
        poolInstance = new OracleConnectionPool();
        break;
      case 'mysql':
        poolInstance = new MySQLConnectionPool();
        break;
      case 'mssql':
        poolInstance = new SqlServerConnectionPool();
        break;
      case 'spanner':
        poolInstance = new SpannerConnectionPool();
        break;
      case 'postgres':
      default:
        poolInstance = new PostgresConnectionPool();
        break;
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

