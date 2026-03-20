import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  DATABASE_TYPE: 'postgres',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: 'postgres',
  POSTGRES_DATABASE: 'postgres',
  POSTGRES_SSL: 'false',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

async function createPool() {
  const pgModule = await import('pg');
  const Pool = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;

  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

function applyBaseEnv(schema: string) {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_TYPE = baseEnv.DATABASE_TYPE;
  process.env.POSTGRES_HOST = baseEnv.POSTGRES_HOST;
  process.env.POSTGRES_PORT = baseEnv.POSTGRES_PORT;
  process.env.POSTGRES_USER = baseEnv.POSTGRES_USER;
  process.env.POSTGRES_PASSWORD = baseEnv.POSTGRES_PASSWORD;
  process.env.POSTGRES_DATABASE = baseEnv.POSTGRES_DATABASE;
  process.env.POSTGRES_SSL = baseEnv.POSTGRES_SSL;
  process.env.ENCRYPTION_KEY = baseEnv.ENCRYPTION_KEY;
  process.env.POSTGRES_SCHEMA = schema;
}

async function cleanupSchemas(...targetSchemas: string[]) {
  const pool = await createPool();
  try {
    for (const targetSchema of targetSchemas) {
      await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(targetSchema)} CASCADE`);
    }
    await pool.query('DROP SCHEMA IF EXISTS main CASCADE');
  } finally {
    await pool.end();
  }
}

describe('Postgres schema auto-migration', () => {
  const targetSchema = `schema_migrate_${Date.now()}`;
  const mixedTargetSchema = `schema_mixed_${Date.now()}`;
  const versioningDriftSchema = `schema_versioning_drift_${Date.now()}`;
  const seedPrefix = `schema_migrate_${Math.random().toString(36).slice(2, 8)}`;

  beforeEach(async () => {
    applyBaseEnv('main');
    vi.resetModules();
    await cleanupSchemas(targetSchema, mixedTargetSchema, versioningDriftSchema);
  });

  afterAll(async () => {
    await cleanupSchemas(targetSchema, mixedTargetSchema, versioningDriftSchema);

    // Restore main schema so other integration tests still find main.users
    applyBaseEnv('main');
    vi.resetModules();
    const { runMigrations } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { closeDataSource } = await import('@enterpriseglue/shared/db/data-source.js');
    try {
      await runMigrations();
    } finally {
      await closeDataSource();
    }
  });

  it('moves existing tables/data from main to configured schema', async () => {
    applyBaseEnv('main');
    vi.resetModules();

    const { runMigrations } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { closeDataSource } = await import('@enterpriseglue/shared/db/data-source.js');
    const { seedUser } = await import('../utils/seed.js');

    let seededUser;
    try {
      await runMigrations();
      seededUser = await seedUser(seedPrefix);
    } finally {
      await closeDataSource();
    }

    applyBaseEnv(targetSchema);
    vi.resetModules();

    const { runMigrations: runMigrationsNext } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { closeDataSource: closeDataSourceNext } = await import('@enterpriseglue/shared/db/data-source.js');

    try {
      await runMigrationsNext();
    } finally {
      await closeDataSourceNext();
    }

    const pool = await createPool();
    try {
      const result = await pool.query(
        `SELECT count(*)::int AS count FROM ${quoteIdentifier(targetSchema)}.users WHERE email = $1`,
        [seededUser.email]
      );
      expect(result.rows[0]?.count).toBe(1);

      const mainTables = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE'"
      );
      expect(mainTables.rows.length).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('reconciles a mixed state where some tables already live in the configured schema', async () => {
    applyBaseEnv('main');
    vi.resetModules();

    const { runMigrations } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { closeDataSource } = await import('@enterpriseglue/shared/db/data-source.js');
    const { seedUser } = await import('../utils/seed.js');

    let seededUser;
    try {
      await runMigrations();
      seededUser = await seedUser(`${seedPrefix}-mixed`);
    } finally {
      await closeDataSource();
    }

    const pool = await createPool();
    const environmentTagId = `${seedPrefix}-env-tag`;
    const environmentTagName = `${seedPrefix}-env-name`;
    const now = Date.now();
    try {
      await pool.query(
        `INSERT INTO ${quoteIdentifier('main')}.${quoteIdentifier('environment_tags')}
          (id, name, color, manual_deploy_allowed, sort_order, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [environmentTagId, environmentTagName, '#123456', true, 0, false, now, now]
      );
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(mixedTargetSchema)}`);
      await pool.query(
        `ALTER TABLE ${quoteIdentifier('main')}.${quoteIdentifier('environment_tags')} SET SCHEMA ${quoteIdentifier(mixedTargetSchema)}`
      );
    } finally {
      await pool.end();
    }

    applyBaseEnv(mixedTargetSchema);
    vi.resetModules();

    const { runMigrations: runMigrationsNext } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { closeDataSource: closeDataSourceNext } = await import('@enterpriseglue/shared/db/data-source.js');

    try {
      await runMigrationsNext();
    } finally {
      await closeDataSourceNext();
    }

    const verifyPool = await createPool();
    try {
      const usersResult = await verifyPool.query(
        `SELECT count(*)::int AS count FROM ${quoteIdentifier(mixedTargetSchema)}.users WHERE email = $1`,
        [seededUser.email]
      );
      expect(usersResult.rows[0]?.count).toBe(1);

      const environmentTagsResult = await verifyPool.query(
        `SELECT count(*)::int AS count FROM ${quoteIdentifier(mixedTargetSchema)}.environment_tags WHERE id = $1 AND name = $2`,
        [environmentTagId, environmentTagName]
      );
      expect(environmentTagsResult.rows[0]?.count).toBe(1);

      const mainTables = await verifyPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE'"
      );
      expect(mainTables.rows.length).toBe(0);
    } finally {
      await verifyPool.end();
    }
  });

  it('repairs critical versioning schema drift even when migrations are already recorded', async () => {
    applyBaseEnv(versioningDriftSchema);
    vi.resetModules();

    const { runMigrations } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { closeDataSource } = await import('@enterpriseglue/shared/db/data-source.js');

    try {
      await runMigrations();
    } finally {
      await closeDataSource();
    }

    const pool = await createPool();
    const projectId = `${seedPrefix}-project`;
    const fileId = `${seedPrefix}-file`;
    const workingFileId = `${seedPrefix}-working-file`;
    const commitId = `${seedPrefix}-commit`;
    const snapshotId = `${seedPrefix}-snapshot`;
    const branchId = `${seedPrefix}-branch`;
    const now = Date.now();

    try {
      await pool.query(
        `INSERT INTO ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('projects')}
          (id, name, owner_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [projectId, `${seedPrefix}-project`, `${seedPrefix}-owner`, null, now, now]
      );

      await pool.query(
        `INSERT INTO ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('files')}
          (id, project_id, folder_id, name, type, xml, bpmn_process_id, dmn_decision_id, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [fileId, projectId, null, 'Invoice', 'bpmn', '<bpmn />', null, null, null, null, now, now]
      );

      await pool.query(
        `INSERT INTO ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('working_files')}
          (id, branch_id, project_id, main_file_id, folder_id, name, type, content, content_hash, is_deleted, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [workingFileId, branchId, projectId, fileId, null, 'Invoice', 'bpmn', '<bpmn />', 'hash-1', false, now, now]
      );

      await pool.query(
        `INSERT INTO ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('file_snapshots')}
          (id, commit_id, working_file_id, main_file_id, folder_id, name, type, content, content_hash, change_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [snapshotId, commitId, workingFileId, fileId, null, 'Invoice', 'bpmn', '<bpmn />', 'hash-1', 'modified']
      );

      await pool.query(`ALTER TABLE ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('file_snapshots')} DROP COLUMN main_file_id`);
      await pool.query(`ALTER TABLE ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('working_files')} DROP COLUMN main_file_id`);
    } finally {
      await pool.end();
    }

    applyBaseEnv(versioningDriftSchema);
    vi.resetModules();

    const { runMigrations: runMigrationsNext } = await import('@enterpriseglue/shared/db/run-migrations.js');
    const { closeDataSource: closeDataSourceNext } = await import('@enterpriseglue/shared/db/data-source.js');

    try {
      await runMigrationsNext();
    } finally {
      await closeDataSourceNext();
    }

    const verifyPool = await createPool();
    try {
      const columnsResult = await verifyPool.query(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name IN ('working_files', 'file_snapshots')
            AND column_name = 'main_file_id'
          ORDER BY table_name`,
        [versioningDriftSchema]
      );
      expect(columnsResult.rows).toEqual([
        { table_name: 'file_snapshots', column_name: 'main_file_id' },
        { table_name: 'working_files', column_name: 'main_file_id' },
      ]);

      const indexesResult = await verifyPool.query(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = $1
            AND indexname IN ('working_files_main_file_idx', 'file_snapshots_main_file_idx')
          ORDER BY indexname`,
        [versioningDriftSchema]
      );
      expect(indexesResult.rows).toEqual([
        { indexname: 'file_snapshots_main_file_idx' },
        { indexname: 'working_files_main_file_idx' },
      ]);

      const workingFileResult = await verifyPool.query(
        `SELECT main_file_id
           FROM ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('working_files')}
          WHERE id = $1`,
        [workingFileId]
      );
      expect(workingFileResult.rows[0]?.main_file_id).toBe(fileId);

      const snapshotResult = await verifyPool.query(
        `SELECT main_file_id
           FROM ${quoteIdentifier(versioningDriftSchema)}.${quoteIdentifier('file_snapshots')}
          WHERE id = $1`,
        [snapshotId]
      );
      expect(snapshotResult.rows[0]?.main_file_id).toBe(fileId);
    } finally {
      await verifyPool.end();
    }
  });
});
