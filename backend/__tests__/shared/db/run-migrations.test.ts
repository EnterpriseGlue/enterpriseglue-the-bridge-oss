import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  LEGACY_LOCAL_ROLE_ASSIGNMENT_PROJECTION_KEY,
  projectLegacyLocalRoleAssignmentsOnce,
  runMigrations,
} from '@enterpriseglue/shared/db/run-migrations.js';
import { getDataSource, adapter } from '@enterpriseglue/shared/db/data-source.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
  adapter: {
    getDatabaseType: vi.fn().mockReturnValue('oracle'),
    getSchemaName: vi.fn().mockReturnValue('public'),
  },
}));

function createBootstrapRunner(hasTable: ReturnType<typeof vi.fn>) {
  return {
    hasTable,
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function createIntegrityRunner(options?: {
  workingFilesHasColumn?: boolean;
  workingFilesHasIndex?: boolean;
  fileSnapshotsHasColumn?: boolean;
  fileSnapshotsHasIndex?: boolean;
  workingFilesMissingMainFileId?: Array<{ id: string; projectId: string; folderId: string | null; name: string; type: string }>;
  mainFiles?: Array<{ id: string; projectId: string; folderId: string | null; name: string; type: string }>;
  snapshotsMissingMainFileId?: Array<{ id: string; workingFileId: string }>;
  workingFilesById?: Array<{ id: string; mainFileId: string | null }>;
}) {
  const workingFilesTable = {
    name: 'working_files',
    schema: 'main',
    columns: options?.workingFilesHasColumn === false ? [] : [{ name: 'main_file_id' }],
    indices: options?.workingFilesHasIndex === false ? [] : [{ name: 'working_files_main_file_idx' }],
  };
  const fileSnapshotsTable = {
    name: 'file_snapshots',
    schema: 'main',
    columns: options?.fileSnapshotsHasColumn === false ? [] : [{ name: 'main_file_id' }],
    indices: options?.fileSnapshotsHasIndex === false ? [] : [{ name: 'file_snapshots_main_file_idx' }],
  };

  const fileRepo = {
    find: vi.fn().mockResolvedValue(options?.mainFiles ?? []),
  };
  const workingFileRepo = {
    find: vi
      .fn()
      .mockResolvedValueOnce(options?.workingFilesMissingMainFileId ?? [])
      .mockResolvedValueOnce(options?.workingFilesById ?? []),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const fileSnapshotRepo = {
    find: vi.fn().mockResolvedValue(options?.snapshotsMissingMainFileId ?? []),
    update: vi.fn().mockResolvedValue(undefined),
  };

  const manager = {
    getRepository: vi.fn((entity: { name: string }) => {
      if (entity.name === 'File') return fileRepo;
      if (entity.name === 'WorkingFile') return workingFileRepo;
      if (entity.name === 'FileSnapshot') return fileSnapshotRepo;
      return {};
    }),
  };

  const resolveTable = (tableName: string) => {
    if (tableName === 'working_files') return workingFilesTable;
    if (tableName === 'file_snapshots') return fileSnapshotsTable;
    return undefined;
  };

  return {
    getTable: vi.fn(async (tableName: string) => resolveTable(tableName)),
    addColumn: vi.fn(async (table: { columns: Array<{ name: string }> }, column: { name: string }) => {
      if (!table.columns.some((entry) => entry.name === column.name)) {
        table.columns.push({ name: column.name });
      }
    }),
    createIndex: vi.fn(async (table: { indices: Array<{ name: string }> }, index: { name: string }) => {
      if (!table.indices.some((entry) => entry.name === index.name)) {
        table.indices.push({ name: index.name });
      }
    }),
    manager,
    release: vi.fn().mockResolvedValue(undefined),
    __repos: {
      fileRepo,
      workingFileRepo,
      fileSnapshotRepo,
    },
  };
}

describe('runMigrations bootstrap behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adapter.getSchemaName as unknown as Mock).mockReturnValue('public');
    (adapter.getDatabaseType as unknown as Mock).mockReturnValue('oracle');
  });

  it('verifies a ready schema without synchronizing or applying migrations', async () => {
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const integrityRunner = createIntegrityRunner();
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({
        tablePath: `main.${String(entity.name).toLowerCase()}`,
      })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations({ mode: 'verify' });

    expect(dataSource.synchronize).not.toHaveBeenCalled();
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(bootstrapRunner.release).toHaveBeenCalledOnce();
    expect(integrityRunner.release).toHaveBeenCalledOnce();
  });

  it('fails verification before application startup when migrations are pending', async () => {
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(bootstrapRunner),
      getMetadata: vi.fn((entity: any) => ({
        tablePath: `main.${String(entity.name).toLowerCase()}`,
      })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await expect(runMigrations({ mode: 'verify' })).rejects.toThrow(
      'Database has pending migrations',
    );
    expect(dataSource.synchronize).not.toHaveBeenCalled();
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
  });

  it('runs synchronize when any core bootstrap table is missing', async () => {
    const bootstrapRunner = createBootstrapRunner(
      vi.fn(async (tablePath: string) => tablePath !== 'main.refresh_tokens')
    );
    const integrityRunner = createIntegrityRunner();

    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => {
        const byName: Record<string, string> = {
          User: 'main.users',
          RefreshToken: 'main.refresh_tokens',
          EnvironmentTag: 'main.environment_tags',
          PlatformSettings: 'main.platform_settings',
          EmailTemplate: 'main.email_templates',
          GitProvider: 'main.git_providers',
        };
        return { tablePath: byName[entity.name] ?? `main.${String(entity.name).toLowerCase()}` };
      }),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(bootstrapRunner.release).toHaveBeenCalledTimes(1);
    expect(integrityRunner.release).toHaveBeenCalledTimes(1);
  });

  it('records historical migrations without replay when a fresh current schema is synchronized', async () => {
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(false));
    const integrityRunner = createIntegrityRunner();

    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({
        tablePath: `main.${String(entity.name).toLowerCase()}`,
      })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).toHaveBeenCalledWith({ fake: true });
    expect(dataSource.showMigrations).not.toHaveBeenCalled();
    expect(bootstrapRunner.release).toHaveBeenCalledTimes(1);
    expect(integrityRunner.release).toHaveBeenCalledTimes(1);
  });

  it('does not fake the migration baseline when a non-core canonical table already exists', async () => {
    const bootstrapRunner = createBootstrapRunner(
      vi.fn(async (tablePath: string) => tablePath === 'main.engines'),
    );
    const integrityRunner = createIntegrityRunner();

    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      entityMetadatas: [
        { tablePath: 'main.users' },
        { tablePath: 'main.engines' },
      ],
      getMetadata: vi.fn((entity: any) => ({
        tablePath: `main.${String(entity.name).toLowerCase()}`,
      })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).toHaveBeenCalledWith({ transaction: 'all' });
    expect(dataSource.runMigrations).not.toHaveBeenCalledWith({ fake: true });
  });

  it('records a fresh Spanner migration baseline without generated IDs', async () => {
    (adapter.getDatabaseType as unknown as Mock).mockReturnValue('spanner');
    (adapter.getSchemaName as unknown as Mock).mockReturnValue('');

    const insert = vi.fn().mockResolvedValue(undefined);
    const ledgerRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const bootstrapRunner = {
      ...createBootstrapRunner(vi.fn().mockResolvedValue(false)),
      createTable: vi.fn().mockResolvedValue(undefined),
    };
    const integrityRunner = createIntegrityRunner();
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(ledgerRunner)
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({
        tablePath: String(entity.name).toLowerCase(),
      })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
      options: { type: 'spanner' },
      migrations: [
        { name: 'FirstMigration1700000000001' },
        { name: 'SecondMigration1700000000002' },
      ],
      driver: {
        instanceDatabase: {
          table: vi.fn().mockReturnValue({ insert }),
        },
      },
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(ledgerRunner.release).toHaveBeenCalledTimes(1);
    expect(bootstrapRunner.createTable).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith([
      { timestamp: 1700000000001, name: 'FirstMigration1700000000001' },
      { timestamp: 1700000000002, name: 'SecondMigration1700000000002' },
    ]);
  });

  it('runs pending Spanner migrations without a transaction', async () => {
    (adapter.getDatabaseType as unknown as Mock).mockReturnValue('spanner');
    (adapter.getSchemaName as unknown as Mock).mockReturnValue('');

    const ledgerRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const integrityRunner = createIntegrityRunner();
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(ledgerRunner)
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({
        tablePath: String(entity.name).toLowerCase(),
      })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
      options: { type: 'spanner' },
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.synchronize).not.toHaveBeenCalled();
    expect(dataSource.runMigrations).toHaveBeenCalledWith({ transaction: 'none' });
    expect(ledgerRunner.release).toHaveBeenCalledTimes(1);
    expect(bootstrapRunner.release).toHaveBeenCalledTimes(1);
    expect(integrityRunner.release).toHaveBeenCalledTimes(1);
  });

  it('skips synchronize when all core bootstrap tables already exist', async () => {
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const integrityRunner = createIntegrityRunner();

    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({ tablePath: `main.${String(entity.name).toLowerCase()}` })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.synchronize).not.toHaveBeenCalled();
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(bootstrapRunner.release).toHaveBeenCalledTimes(1);
    expect(integrityRunner.release).toHaveBeenCalledTimes(1);
  });

  it('self-heals a partial bootstrap on first run and remains stable on second run', async () => {
    const firstBootstrapRunner = createBootstrapRunner(
      vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true)
    );
    const firstIntegrityRunner = createIntegrityRunner();
    const secondBootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const secondIntegrityRunner = createIntegrityRunner();

    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(firstBootstrapRunner)
        .mockReturnValueOnce(firstIntegrityRunner)
        .mockReturnValueOnce(secondBootstrapRunner)
        .mockReturnValueOnce(secondIntegrityRunner),
      getMetadata: vi.fn((entity: any) => ({ tablePath: `main.${String(entity.name).toLowerCase()}` })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();
    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);

    // second run: everything exists
    dataSource.showMigrations.mockResolvedValue(true);

    await runMigrations();

    expect(dataSource.synchronize).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(firstBootstrapRunner.release).toHaveBeenCalledTimes(1);
    expect(firstIntegrityRunner.release).toHaveBeenCalledTimes(1);
    expect(secondBootstrapRunner.release).toHaveBeenCalledTimes(1);
    expect(secondIntegrityRunner.release).toHaveBeenCalledTimes(1);
  });

  it('reconciles mixed postgres schemas when objects are split across main and the configured schema', async () => {
    (adapter.getSchemaName as unknown as Mock).mockReturnValue('onejob_sbx');
    (adapter.getDatabaseType as unknown as Mock).mockReturnValue('postgres');

    const ensureSchemaRunner = {
      hasSchema: vi.fn().mockResolvedValue(true),
      createSchema: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const migrationRunner = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('information_schema.tables') && params?.[0] === 'main') {
          return [{ table_name: 'users' }, { table_name: 'refresh_tokens' }];
        }
        if (sql.includes('information_schema.tables') && params?.[0] === 'onejob_sbx') {
          return [{ table_name: 'environment_tags' }];
        }
        if (sql.includes('pg_class') && params?.[0] === 'main') {
          return [{ sequence_name: 'orphan_sequence' }];
        }
        if (sql.includes('pg_class') && params?.[0] === 'onejob_sbx') {
          return [];
        }
        if (sql.includes('pg_type')) {
          return [];
        }
        return undefined;
      }),
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      hasTable: vi.fn().mockResolvedValue(true),
      hasSchema: vi.fn().mockResolvedValue(true),
      createSchema: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const integrityRunner = {
      ...createIntegrityRunner(),
      connection: { options: { type: 'postgres' }, entityMetadatas: [] },
    };

    const dataSource = {
      createQueryRunner: vi
        .fn()
        .mockReturnValueOnce(ensureSchemaRunner)
        .mockReturnValueOnce(migrationRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({ tablePath: `onejob_sbx.${String(entity.name).toLowerCase()}` })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(migrationRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(migrationRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(migrationRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(migrationRunner.query).toHaveBeenCalledWith(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
      ['main']
    );
    expect(migrationRunner.query).toHaveBeenCalledWith(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
      ['onejob_sbx']
    );
    expect(migrationRunner.query).toHaveBeenCalledWith(
      'ALTER SEQUENCE "main"."orphan_sequence" SET SCHEMA "onejob_sbx"'
    );
    expect(migrationRunner.query).toHaveBeenCalledWith('ALTER TABLE "main"."users" SET SCHEMA "onejob_sbx"');
    expect(migrationRunner.query).toHaveBeenCalledWith('ALTER TABLE "main"."refresh_tokens" SET SCHEMA "onejob_sbx"');
    const moveSequenceIndex = migrationRunner.query.mock.calls.findIndex(
      (call: [string, unknown[]?]) => call[0] === 'ALTER SEQUENCE "main"."orphan_sequence" SET SCHEMA "onejob_sbx"'
    );
    const moveUsersTableIndex = migrationRunner.query.mock.calls.findIndex(
      (call: [string, unknown[]?]) => call[0] === 'ALTER TABLE "main"."users" SET SCHEMA "onejob_sbx"'
    );
    const moveSequenceCall = migrationRunner.query.mock.invocationCallOrder[
      moveSequenceIndex
    ];
    const moveUsersTableCall = migrationRunner.query.mock.invocationCallOrder[
      moveUsersTableIndex
    ];
    expect(moveSequenceCall).toBeLessThan(moveUsersTableCall);
    expect(dataSource.synchronize).not.toHaveBeenCalled();
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(ensureSchemaRunner.release).toHaveBeenCalledTimes(1);
    expect(migrationRunner.release).toHaveBeenCalledTimes(1);
    expect(integrityRunner.release).toHaveBeenCalledTimes(1);
  });

  it('fails fast when the same postgres object exists in both main and the configured schema', async () => {
    (adapter.getSchemaName as unknown as Mock).mockReturnValue('onejob_sbx');
    (adapter.getDatabaseType as unknown as Mock).mockReturnValue('postgres');

    const ensureSchemaRunner = {
      hasSchema: vi.fn().mockResolvedValue(true),
      createSchema: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const migrationRunner = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('information_schema.tables') && params?.[0] === 'main') {
          return [{ table_name: 'users' }];
        }
        if (sql.includes('information_schema.tables') && params?.[0] === 'onejob_sbx') {
          return [{ table_name: 'users' }];
        }
        if (sql.includes('pg_class')) {
          return [];
        }
        if (sql.includes('pg_type')) {
          return [];
        }
        return undefined;
      }),
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      hasTable: vi.fn().mockResolvedValue(true),
      hasSchema: vi.fn().mockResolvedValue(true),
      createSchema: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const dataSource = {
      createQueryRunner: vi
        .fn()
        .mockReturnValueOnce(ensureSchemaRunner)
        .mockReturnValueOnce(migrationRunner),
      getMetadata: vi.fn((entity: any) => ({ tablePath: `onejob_sbx.${String(entity.name).toLowerCase()}` })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(false),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await expect(runMigrations()).rejects.toThrow(
      'Detected conflicting objects in both "main" and "onejob_sbx" schemas (tables: users)'
    );

    expect(migrationRunner.startTransaction).not.toHaveBeenCalled();
    expect(migrationRunner.commitTransaction).not.toHaveBeenCalled();
    expect(migrationRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(dataSource.synchronize).not.toHaveBeenCalled();
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(ensureSchemaRunner.release).toHaveBeenCalledTimes(1);
    expect(migrationRunner.release).toHaveBeenCalledTimes(1);
  });

  it('reconciles critical versioning schema drift after migrations complete', async () => {
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const integrityRunner = createIntegrityRunner({
      workingFilesHasColumn: false,
      workingFilesHasIndex: false,
      fileSnapshotsHasColumn: false,
      fileSnapshotsHasIndex: false,
      workingFilesMissingMainFileId: [
        { id: 'wf-1', projectId: 'project-1', folderId: null, name: 'Invoice', type: 'bpmn' },
      ],
      mainFiles: [
        { id: 'file-1', projectId: 'project-1', folderId: null, name: 'Invoice', type: 'bpmn' },
      ],
      snapshotsMissingMainFileId: [
        { id: 'fs-1', workingFileId: 'wf-1' },
      ],
      workingFilesById: [
        { id: 'wf-1', mainFileId: 'file-1' },
      ],
    });

    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({ tablePath: `main.${String(entity.name).toLowerCase()}` })),
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(integrityRunner.addColumn).toHaveBeenCalledTimes(2);
    expect(integrityRunner.createIndex).toHaveBeenCalledTimes(2);
    expect(integrityRunner.__repos.workingFileRepo.update).toHaveBeenCalledWith({ id: 'wf-1' }, { mainFileId: 'file-1' });
    expect(integrityRunner.__repos.fileSnapshotRepo.update).toHaveBeenCalledWith({ id: 'fs-1' }, { mainFileId: 'file-1' });
    expect(bootstrapRunner.release).toHaveBeenCalledTimes(1);
    expect(integrityRunner.release).toHaveBeenCalledTimes(1);
  });
});

describe('projectLegacyLocalRoleAssignmentsOnce', () => {
  it('projects retained local rows once and records a durable marker in the same transaction', async () => {
    const stateRepo = {
      findOneBy: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: LEGACY_LOCAL_ROLE_ASSIGNMENT_PROJECTION_KEY }),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const manager = { getRepository: vi.fn().mockReturnValue(stateRepo) };
    const dataSource = {
      transaction: vi.fn(async (callback: (transactionManager: typeof manager) => unknown) => callback(manager)),
    };
    const syncLegacyRoleAssignments = vi.spyOn(permissionService, 'syncLegacyRoleAssignments')
      .mockResolvedValue({ scannedProjects: 2, scannedEngines: 3, upserted: 4, removed: 1 });

    try {
      await expect(projectLegacyLocalRoleAssignmentsOnce(dataSource as never, 123)).resolves.toEqual({
        scannedProjects: 2,
        scannedEngines: 3,
        upserted: 4,
        removed: 1,
      });
      await expect(projectLegacyLocalRoleAssignmentsOnce(dataSource as never, 124)).resolves.toBeNull();

      expect(syncLegacyRoleAssignments).toHaveBeenCalledTimes(1);
      expect(syncLegacyRoleAssignments).toHaveBeenCalledWith({ now: 123 }, manager);
      expect(stateRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
        key: LEGACY_LOCAL_ROLE_ASSIGNMENT_PROJECTION_KEY,
        completedAt: 123,
        details: JSON.stringify({ scannedProjects: 2, scannedEngines: 3, upserted: 4, removed: 1 }),
      }), { conflictPaths: ['key'], skipUpdateIfNoValuesChanged: true });
    } finally {
      syncLegacyRoleAssignments.mockRestore();
    }
  });
});
