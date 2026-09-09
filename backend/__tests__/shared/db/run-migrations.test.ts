import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MigrationExecutor } from 'typeorm';
import {
  LEGACY_LOCAL_ROLE_ASSIGNMENT_PROJECTION_KEY,
  projectLegacyLocalRoleAssignmentsOnce,
  runMigrations,
  runSchemaEpochOwnerMigrations,
} from '@enterpriseglue/shared/db/run-migrations.js';
import { getDataSource, adapter } from '@enterpriseglue/shared/db/data-source.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { refreshPostgresRuntimeGrants } from '@enterpriseglue/shared/db/postgres-runtime-grants.js';
import { grantSchemaEpochReleaseEffectCohortRuntimePrivileges } from '@enterpriseglue/shared/db/schema-epoch-runtime-grant.js';
import { AddPostgresTenantRls1700000000126 } from '@enterpriseglue/shared/db/migrations/1700000000126-add-postgres-tenant-rls.js';
import { withPostgresMigrationContext } from '@enterpriseglue/shared/db/postgres-migration-context.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { verifyExecutedSchemaEpoch, verifyOwnerMigrationStartingEpoch } from '@enterpriseglue/shared/db/schema-epoch.js';

vi.mock('@enterpriseglue/shared/db/schema-epoch.js', async () => {
  const actual = await vi.importActual<typeof import('@enterpriseglue/shared/db/schema-epoch.js')>(
    '@enterpriseglue/shared/db/schema-epoch.js',
  );
  return {
    ...actual,
    verifyExecutedSchemaEpoch: vi.fn(),
    verifyOwnerMigrationStartingEpoch: vi.fn(),
  };
});

// Owner verification and lease/pool behavior have real PostgreSQL coverage;
// this suite isolates runMigrations orchestration from the database transport.
vi.mock('@enterpriseglue/shared/db/postgres-migration-context.js', () => ({
  withPostgresMigrationContext: vi.fn(async (_source: unknown, _mode: unknown, work: () => Promise<unknown>) => work()),
}));

vi.mock('@enterpriseglue/shared/db/postgres-runtime-grants.js', () => ({
  refreshPostgresRuntimeGrants: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@enterpriseglue/shared/db/schema-epoch-runtime-grant.js', () => ({
  grantSchemaEpochReleaseEffectCohortRuntimePrivileges: vi.fn().mockResolvedValue(undefined),
}));

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

function registeredMigrationIdentities() {
  const directory = path.resolve(process.cwd(), '../packages/shared/src/db/migrations');
  return readdirSync(directory)
    .filter((file) => /^\d.*\.ts$/.test(file))
    .flatMap((file) => {
      const source = readFileSync(path.join(directory, file), 'utf8');
      return [...source.matchAll(/export class\s+([A-Za-z0-9_]+)\s+implements\s+MigrationInterface/g)]
        .map((match) => ({ name: match[1] }));
    });
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
  it('rejects the optional runtime role on non-PostgreSQL before opening a connection', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', 'eg_runtime');
    try {
      await expect(runMigrations()).rejects.toThrow('only by PostgreSQL apply-mode');
      expect(getDataSource).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects runtime grant configuration in read-only verification mode', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', 'eg_runtime');
    vi.mocked(adapter.getDatabaseType).mockReturnValue('postgres');
    try {
      await expect(runMigrations({ mode: 'verify' })).rejects.toThrow('only by PostgreSQL apply-mode');
      expect(getDataSource).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('lets the owner job apply only the signed migration ceiling without policy or repair side effects', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', 'eg_runtime');
    vi.mocked(adapter.getDatabaseType).mockReturnValue('postgres');
    const previousTenancyMode = config.tenancyMode;
    (config as { tenancyMode: string }).tenancyMode = 'pooled';
    const rlsRepair = vi.spyOn(AddPostgresTenantRls1700000000126.prototype, 'up');
    const rbacSeed = vi.spyOn(permissionService, 'seedRbacFoundation');
    const legacyPredicate = "((COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode'::text, true), ''::text), 'single'::text) <> 'pooled'::text) OR (tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id'::text, true), ''::text)))";
    const policyRunner = {
      ...createIntegrityRunner(),
      connection: {
        options: { type: 'postgres', schema: 'public' },
        entityMetadatas: [{
          tableName: 'projects',
          tablePath: 'public.projects',
          schema: 'public',
          columns: [{ databaseName: 'tenant_id' }],
        }],
      },
      hasTable: vi.fn().mockResolvedValue(true),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('json_agg')) return [{
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: [{
            policy_name: 'eg_tenant_isolation',
            command: 'ALL',
            permissive: 'PERMISSIVE',
            roles: ['public'],
            using_expression: legacyPredicate,
            check_expression: legacyPredicate,
          }],
        }];
        if (sql.includes('current_user AS role')) return [{
          role: 'eg_runtime',
          rolsuper: false,
          rolbypassrls: false,
        }];
        throw new Error(`Unexpected owner bridge query: ${sql}`);
      }),
    };
    const dataSource = {
      migrations: registeredMigrationIdentities(),
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(policyRunner)
        .mockReturnValueOnce(policyRunner),
      getMetadata: vi.fn((entity: { name: string }) => ({ tablePath: `public.${entity.name.toLowerCase()}` })),
      entityMetadatas: [],
      synchronize: vi.fn(),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn(),
    };
    vi.mocked(getDataSource).mockResolvedValue(dataSource as any);
    vi.mocked(verifyOwnerMigrationStartingEpoch).mockResolvedValue('owner-source');
    vi.mocked(verifyExecutedSchemaEpoch).mockResolvedValue({
      id: 'pre-enforcement',
      through: 1700000000131,
      count: 133,
      sha256: '12d8f4fe707e5f8a320f187979c5546c6b17198477a182c99c4ae3d8448417e1',
      postgresPolicyProfile: 'legacy-explicit-runtime-compatible/v1',
    });

    try {
      await runSchemaEpochOwnerMigrations();
      expect(dataSource.runMigrations).toHaveBeenCalledOnce();
      expect(verifyOwnerMigrationStartingEpoch).toHaveBeenCalledOnce();
      expect(dataSource.migrations.at(-1)?.name).toBe('AddReleaseEffectCohorts1700000000131');
      expect(dataSource.synchronize).not.toHaveBeenCalled();
      expect(rlsRepair).not.toHaveBeenCalled();
      expect(policyRunner.addColumn).not.toHaveBeenCalled();
      expect(policyRunner.createIndex).not.toHaveBeenCalled();
      expect(rbacSeed).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(withPostgresMigrationContext).not.toHaveBeenCalled();
      expect(grantSchemaEpochReleaseEffectCohortRuntimePrivileges).toHaveBeenCalledExactlyOnceWith(
        dataSource,
        policyRunner,
        'eg_runtime',
      );
      expect(refreshPostgresRuntimeGrants).not.toHaveBeenCalled();
      expect(policyRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('json_agg'),
        ['public', 'projects'],
      );
    } finally {
      (config as { tenancyMode: string }).tenancyMode = previousTenancyMode;
      rlsRepair.mockRestore();
      rbacSeed.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('rejects empty, partial, or unexpected owner ledgers before any database mutation', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', 'eg_runtime');
    vi.mocked(adapter.getDatabaseType).mockReturnValue('postgres');
    const previousTenancyMode = config.tenancyMode;
    (config as { tenancyMode: string }).tenancyMode = 'pooled';
    const runner = { release: vi.fn().mockResolvedValue(undefined) };
    const dataSource = {
      migrations: registeredMigrationIdentities(),
      createQueryRunner: vi.fn().mockReturnValue(runner),
      showMigrations: vi.fn(),
      runMigrations: vi.fn(),
      synchronize: vi.fn(),
    };
    vi.mocked(getDataSource).mockResolvedValue(dataSource as any);
    vi.mocked(verifyOwnerMigrationStartingEpoch).mockRejectedValue(
      new Error('Owner migration starting epoch is not accepted'),
    );

    try {
      await expect(runSchemaEpochOwnerMigrations()).rejects.toThrow(/starting epoch is not accepted/);
      expect(dataSource.showMigrations).not.toHaveBeenCalled();
      expect(dataSource.runMigrations).not.toHaveBeenCalled();
      expect(dataSource.synchronize).not.toHaveBeenCalled();
      expect(withPostgresMigrationContext).not.toHaveBeenCalled();
      expect(grantSchemaEpochReleaseEffectCohortRuntimePrivileges).not.toHaveBeenCalled();
      expect(runner).not.toHaveProperty('query');
    } finally {
      (config as { tenancyMode: string }).tenancyMode = previousTenancyMode;
      vi.unstubAllEnvs();
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    (adapter.getSchemaName as unknown as Mock).mockReturnValue('public');
    (adapter.getDatabaseType as unknown as Mock).mockReturnValue('oracle');
  });

  it('refreshes runtime grants only after pending migrations and critical schema repair, before releasing the runner', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', 'eg_runtime');
    vi.mocked(adapter.getDatabaseType).mockReturnValue('postgres');
    const rls = vi.spyOn(AddPostgresTenantRls1700000000126.prototype, 'up').mockResolvedValue(undefined);
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const integrityRunner = createIntegrityRunner({ workingFilesHasColumn: false, workingFilesHasIndex: false });
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(bootstrapRunner).mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: { name: string }) => ({ tablePath: `main.${entity.name.toLowerCase()}` })),
      synchronize: vi.fn(),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDataSource).mockResolvedValue(dataSource as any);
    try {
      await runMigrations();
      expect(dataSource.runMigrations).toHaveBeenCalledWith({ transaction: 'all' });
      expect(integrityRunner.addColumn).toHaveBeenCalledOnce();
      expect(integrityRunner.createIndex).toHaveBeenCalledOnce();
      expect(refreshPostgresRuntimeGrants).toHaveBeenCalledExactlyOnceWith(integrityRunner, 'eg_runtime');
      const migrationOrder = dataSource.runMigrations.mock.invocationCallOrder[0];
      const repairOrder = integrityRunner.createIndex.mock.invocationCallOrder[0];
      const grantOrder = vi.mocked(refreshPostgresRuntimeGrants).mock.invocationCallOrder[0];
      expect(migrationOrder).toBeLessThan(integrityRunner.addColumn.mock.invocationCallOrder[0]);
      expect(repairOrder).toBeLessThan(grantOrder);
      expect(grantOrder).toBeLessThan(integrityRunner.release.mock.invocationCallOrder[0]);
    } finally {
      rls.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('never refreshes runtime grants when a pending migration fails', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', 'eg_runtime');
    vi.mocked(adapter.getDatabaseType).mockReturnValue('postgres');
    const bootstrapRunner = createBootstrapRunner(vi.fn().mockResolvedValue(true));
    const dataSource = {
      createQueryRunner: vi.fn().mockReturnValueOnce(bootstrapRunner),
      getMetadata: vi.fn((entity: { name: string }) => ({ tablePath: `main.${entity.name.toLowerCase()}` })),
      synchronize: vi.fn(),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockRejectedValue(new Error('migration rejected')),
    };
    vi.mocked(getDataSource).mockResolvedValue(dataSource as any);
    try {
      await expect(runMigrations()).rejects.toThrow('migration rejected');
      expect(refreshPostgresRuntimeGrants).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).toHaveBeenCalledOnce();
      expect(bootstrapRunner.release).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); }
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

  it('recovers the empty ledger produced by the v0.20.0 published image', async () => {
    const executedMigrations = vi
      .spyOn(MigrationExecutor.prototype, 'getExecutedMigrations')
      .mockResolvedValue([]);
    const bootstrapRunner = {
      ...createBootstrapRunner(vi.fn().mockResolvedValue(true)),
      getTable: vi.fn(async (tablePath: string) => {
        if (tablePath === 'main.users') {
          return { name: 'users', schema: 'main', columns: [{ name: 'id' }] };
        }
        return undefined;
      }),
    };
    const integrityRunner = createIntegrityRunner();
    const migrations = Array.from({ length: 131 }, (_, index) => ({
      name: `Migration${1700000000000 + index}`,
    }));
    migrations.push({ name: 'AlternateMigration1700000000085' });
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({
        tablePath: `main.${String(entity.name).toLowerCase()}`,
      })),
      entityMetadatas: [{
        tablePath: 'main.users',
        columns: [{ databaseName: 'id' }],
      }],
      migrations,
      options: { migrationsTableName: 'migrations' },
      driver: {
        options: { type: 'postgres', schema: 'main' },
        database: 'eg_test',
        buildTableName: vi.fn().mockReturnValue('main.migrations'),
      },
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(executedMigrations).toHaveBeenCalledOnce();
    expect(dataSource.runMigrations).toHaveBeenCalledOnce();
    expect(dataSource.runMigrations).toHaveBeenCalledWith({ fake: true });
    expect(dataSource.showMigrations).not.toHaveBeenCalled();
    executedMigrations.mockRestore();
  });

  it('does not baseline an empty ledger when the entity column shape is incomplete', async () => {
    const executedMigrations = vi
      .spyOn(MigrationExecutor.prototype, 'getExecutedMigrations')
      .mockResolvedValue([]);
    const bootstrapRunner = {
      ...createBootstrapRunner(vi.fn().mockResolvedValue(true)),
      getTable: vi.fn(async (tablePath: string) => tablePath === 'main.users'
        ? { name: 'users', schema: 'main', columns: [{ name: 'legacy_id' }] }
        : undefined),
    };
    const integrityRunner = createIntegrityRunner();
    const migrations = Array.from({ length: 131 }, (_, index) => ({
      name: `Migration${1700000000000 + index}`,
    }));
    migrations.push({ name: 'AlternateMigration1700000000085' });
    const dataSource = {
      createQueryRunner: vi.fn()
        .mockReturnValueOnce(bootstrapRunner)
        .mockReturnValueOnce(integrityRunner),
      getMetadata: vi.fn((entity: any) => ({
        tablePath: `main.${String(entity.name).toLowerCase()}`,
      })),
      entityMetadatas: [{
        tablePath: 'main.users',
        columns: [{ databaseName: 'id' }],
      }],
      migrations,
      options: { migrationsTableName: 'migrations' },
      driver: {
        options: { type: 'postgres', schema: 'main' },
        database: 'eg_test',
        buildTableName: vi.fn().mockReturnValue('main.migrations'),
      },
      synchronize: vi.fn().mockResolvedValue(undefined),
      showMigrations: vi.fn().mockResolvedValue(true),
      runMigrations: vi.fn().mockResolvedValue(undefined),
    };
    (getDataSource as unknown as Mock).mockResolvedValue(dataSource);

    await runMigrations();

    expect(executedMigrations).toHaveBeenCalledOnce();
    expect(dataSource.runMigrations).toHaveBeenCalledOnce();
    expect(dataSource.runMigrations).toHaveBeenCalledWith({ transaction: 'all' });
    expect(dataSource.runMigrations).not.toHaveBeenCalledWith({ fake: true });
    executedMigrations.mockRestore();
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
