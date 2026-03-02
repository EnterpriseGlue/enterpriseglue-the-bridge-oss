import 'reflect-metadata';
import { DataSource, Repository, EntityTarget, ObjectLiteral } from 'typeorm';
import { getAdapter, DatabaseAdapter } from './adapters/index.js';

// Get the database adapter based on configuration
const adapter: DatabaseAdapter = getAdapter();

// Create DataSource using adapter configuration
export const AppDataSource = new DataSource(adapter.getDataSourceOptions());

// Export adapter for use in other modules
export { adapter };

let initialized = false;

export async function getDataSource(): Promise<DataSource> {
  if (!initialized) {
    await AppDataSource.initialize();
    initialized = true;
    console.log('✅ TypeORM DataSource initialized');
  }
  return AppDataSource;
}

/**
 * Convenience helper to get a repository for an entity
 * Reduces boilerplate: const repo = await getRepository(User)
 * Instead of: const ds = await getDataSource(); const repo = ds.getRepository(User)
 */
export async function getRepository<T extends ObjectLiteral>(entity: EntityTarget<T>): Promise<Repository<T>> {
  const dataSource = await getDataSource();
  return dataSource.getRepository(entity);
}

export async function closeDataSource(): Promise<void> {
  if (initialized && AppDataSource.isInitialized) {
    await AppDataSource.destroy();
    initialized = false;
  }
}
