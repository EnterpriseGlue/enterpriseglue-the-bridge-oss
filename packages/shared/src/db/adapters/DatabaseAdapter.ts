import { DataSourceOptions } from 'typeorm';

/**
 * Database Adapter Interface
 * Provides abstraction layer for database-specific operations
 */
export interface DatabaseAdapter {
  /**
   * Get TypeORM DataSource configuration options
   */
  getDataSourceOptions(): DataSourceOptions;

  /**
   * Get the schema name for this database
   */
  getSchemaName(): string;

  /**
   * Get the database type identifier
   */
  getDatabaseType(): 'postgres' | 'oracle' | 'mssql' | 'spanner' | 'mysql';

  /**
   * Format an identifier (table/column name) for this database
   * Oracle typically uses uppercase, PostgreSQL uses lowercase
   */
  formatIdentifier(name: string): string;

  /**
   * @deprecated Use TypeORM QueryRunner schema APIs (`hasSchema`, `createSchema`) instead.
   * Retained temporarily for OSS->EE sync compatibility until EE call sites are migrated.
   */
  getCreateSchemaSQL(schemaName: string): string;

  /**
   * Check if a specific feature is supported by this database
   */
  supportsFeature(feature: DatabaseFeature): boolean;

  /**
   * Get the path to database-specific SQL files
   */
  getSqlFilesPath(): string;

  /**
   * Get migrations path for this database type
   */
  getMigrationsPath(): string;
}

/**
 * Database features that may vary between implementations
 */
export type DatabaseFeature = 
  | 'ilike'           // Case-insensitive LIKE (PostgreSQL)
  | 'returning'       // RETURNING clause support
  | 'onConflict'      // ON CONFLICT / UPSERT support
  | 'jsonb'           // JSONB type support
  | 'uuid'            // Native UUID type
  | 'sequences';      // Sequence-based ID generation

/**
 * Base configuration shared across all database adapters
 */
export interface BaseAdapterConfig {
  schema: string;
  logging: boolean;
  synchronize: boolean;
}
