import type {
  EnterpriseDatabaseContext,
  EnterpriseDatabaseType,
} from '@enterpriseglue/enterprise-plugin-api/backend';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import type { DataSource } from 'typeorm';

interface EnterpriseDatabaseContextOptions {
  databaseType: EnterpriseDatabaseType;
  resolveDataSource?: () => Promise<DataSource>;
}

/**
 * Expose only TypeORM's portable command boundary to enterprise plugins. Raw
 * driver pools remain a deprecated compatibility path because their SQL and
 * parameter syntax cannot be consistent across the five supported adapters.
 */
export function createEnterpriseDatabaseContext({
  databaseType,
  resolveDataSource = getDataSource,
}: EnterpriseDatabaseContextOptions): EnterpriseDatabaseContext {
  return {
    kind: 'typeorm',
    databaseType,
    async getDataSource<TDataSource = unknown>() {
      return await resolveDataSource() as TDataSource;
    },
    async transaction<TResult>(work: (manager: unknown) => Promise<TResult>) {
      const dataSource = await resolveDataSource();
      return dataSource.transaction((manager) => work(manager));
    },
  };
}
