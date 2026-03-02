import { config } from '@enterpriseglue/shared/config/index.js';
import { DatabaseAdapter } from './DatabaseAdapter.js';
import { PostgresAdapter } from './PostgresAdapter.js';
import { OracleAdapter } from './OracleAdapter.js';
import { SqlServerAdapter } from './SqlServerAdapter.js';
import { SpannerAdapter } from './SpannerAdapter.js';
import { MySQLAdapter } from './MySQLAdapter.js';

export type { DatabaseAdapter, DatabaseFeature, BaseAdapterConfig } from './DatabaseAdapter.js';
export { PostgresAdapter } from './PostgresAdapter.js';
export { OracleAdapter } from './OracleAdapter.js';
export { SqlServerAdapter } from './SqlServerAdapter.js';
export { SpannerAdapter } from './SpannerAdapter.js';
export { MySQLAdapter } from './MySQLAdapter.js';
export {
  addCaseInsensitiveEquals,
  addCaseInsensitiveLike,
  caseInsensitiveColumn,
  caseInsensitiveValue,
  supportsFeature,
  getDatabaseType,
} from './QueryHelpers.js';

/**
 * Singleton adapter instance
 */
let adapterInstance: DatabaseAdapter | null = null;

/**
 * Get the database adapter for the configured database type
 * Returns a singleton instance
 */
export function getAdapter(): DatabaseAdapter {
  if (!adapterInstance) {
    adapterInstance = createAdapter(config.databaseType);
  }
  return adapterInstance;
}

/**
 * Create a new database adapter instance
 * @param dbType - The database type
 */
export function createAdapter(dbType: 'postgres' | 'oracle' | 'mssql' | 'spanner' | 'mysql'): DatabaseAdapter {
  switch (dbType) {
    case 'oracle':
      return new OracleAdapter();
    case 'mssql':
      return new SqlServerAdapter();
    case 'spanner':
      return new SpannerAdapter();
    case 'mysql':
      return new MySQLAdapter();
    case 'postgres':
    default:
      return new PostgresAdapter();
  }
}

/**
 * Reset the adapter singleton (useful for testing)
 */
export function resetAdapter(): void {
  adapterInstance = null;
}
