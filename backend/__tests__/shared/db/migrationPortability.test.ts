import { describe, expect, it, vi } from 'vitest';
import { TableColumn } from 'typeorm';
import {
  addRequiredColumnWithBackfill,
  portableBigint,
  portableBoolean,
  portableBooleanDefault,
  portableInteger,
  portableNumberDefault,
  portableStringDefault,
  portableText,
  sqlBooleanLiteral,
} from '@enterpriseglue/shared/db/migrations/support/portable-columns.js';
import { UpgradeLegacySamlSignatures1700000000065 } from '@enterpriseglue/shared/db/migrations/1700000000065-upgrade-legacy-saml-signatures.js';
import { AddExternalEngineRegistrationIdentities1700000000108 } from '@enterpriseglue/shared/db/migrations/1700000000108-add-external-engine-registration-identities.js';
import { RequireProjectTenantOwnership1700000000109 } from '@enterpriseglue/shared/db/migrations/1700000000109-require-project-tenant-ownership.js';

function runner(database: string) {
  return {
    connection: {
      options: { type: database },
      driver: {
        escape: (value: string) => `\`${value}\``,
        createFullType: (column: TableColumn) => column.length
          ? `${column.type}(${column.length})`
          : column.type,
      },
    },
  } as any;
}

describe('portable migration columns', () => {
  it.each([
    ['postgres', { type: 'text' }, { type: 'boolean' }, { type: 'integer' }, { type: 'bigint' }],
    ['mysql', { type: 'varchar', length: '4000' }, { type: 'boolean' }, { type: 'integer' }, { type: 'bigint' }],
    ['mssql', { type: 'nvarchar', length: '4000' }, { type: 'bit' }, { type: 'integer' }, { type: 'bigint' }],
    ['oracle', { type: 'varchar2', length: '4000' }, { type: 'number', precision: 1, scale: 0 }, { type: 'number', precision: 10, scale: 0 }, { type: 'number', precision: 19, scale: 0 }],
    ['spanner', { type: 'string', length: '4096' }, { type: 'bool' }, { type: 'int64' }, { type: 'int64' }],
  ])('maps TypeORM migration columns for %s', (database, text, boolean, integer, bigint) => {
    const queryRunner = runner(database as string);
    expect(portableText(queryRunner)).toEqual(text);
    expect(portableBoolean(queryRunner)).toEqual(boolean);
    expect(portableInteger(queryRunner)).toEqual(integer);
    expect(portableBigint(queryRunner)).toEqual(bigint);
  });

  it('omits unsupported Spanner defaults and emits adapter-safe boolean literals', () => {
    const spanner = runner('spanner');
    expect(portableStringDefault(spanner, 'manual')).toBeUndefined();
    expect(portableBooleanDefault(spanner, false)).toBeUndefined();
    expect(portableNumberDefault(spanner, 0)).toBeUndefined();
    expect(sqlBooleanLiteral(spanner, false)).toBe('FALSE');

    expect(portableStringDefault(runner('mysql'), 'manual')).toBe("'manual'");
    expect(portableBooleanDefault(runner('mssql'), false)).toBe(0);
    expect(sqlBooleanLiteral(runner('oracle'), true)).toBe('1');
    expect(sqlBooleanLiteral(runner('postgres'), false)).toBe('FALSE');
  });

  it('uses a nullable-add/backfill/required sequence for Spanner upgrades', async () => {
    let storedColumn: TableColumn | undefined;
    const query = vi.fn(async (_sql: string) => undefined);
    const updateDDL = vi.fn(async () => undefined);
    const queryRunner = {
      ...runner('spanner'),
      hasColumn: vi.fn(async () => Boolean(storedColumn)),
      addColumn: vi.fn(async (_table: string, column: TableColumn) => {
        storedColumn = column.clone();
      }),
      getTable: vi.fn(async () => ({ columns: storedColumn ? [storedColumn.clone()] : [] })),
      query,
      updateDDL,
    } as any;

    await addRequiredColumnWithBackfill(
      queryRunner,
      'platform_settings',
      new TableColumn({ name: 'mode', type: 'string', length: '4096' }),
      "'manual'",
    );

    expect(queryRunner.addColumn).toHaveBeenCalledWith(
      'platform_settings',
      expect.objectContaining({ name: 'mode', isNullable: true, default: undefined }),
    );
    expect(query).toHaveBeenCalledWith(
      "UPDATE `platform_settings` SET `mode` = 'manual' WHERE `mode` IS NULL",
    );
    expect(updateDDL).toHaveBeenCalledWith(
      'ALTER TABLE `platform_settings` ALTER COLUMN `mode` string(4096) NOT NULL',
    );
  });
});

describe('portable data migrations', () => {
  it.each([
    ['postgres', 'tenant_auth.sso_providers', '"tenant_auth"."sso_providers"'],
    ['mysql', 'tenant_auth.sso_providers', '`tenant_auth`.`sso_providers`'],
    ['mssql', 'tenant_auth.sso_providers', '[tenant_auth].[sso_providers]'],
    ['oracle', 'TENANT_AUTH.SSO_PROVIDERS', '"TENANT_AUTH"."SSO_PROVIDERS"'],
  ])('targets the resolved %s schema-qualified table', async (database, resolvedName, escapedName) => {
    const escape = (value: string): string => {
      if (database === 'mysql') return `\`${value}\``;
      if (database === 'mssql') return `[${value}]`;
      return `"${value}"`;
    };
    const query = vi.fn(async (_sql: string) => undefined);
    const queryRunner = {
      connection: {
        getMetadata: vi.fn(() => { throw new Error('legacy table is not entity-backed'); }),
        driver: { escape },
      },
      getTable: vi.fn(async () => ({
        name: resolvedName,
        findColumnByName: (name: string) => name === 'signature_algorithm' ? { name } : undefined,
      })),
      query,
    } as any;

    await new UpgradeLegacySamlSignatures1700000000065().up(queryRunner);

    expect(queryRunner.getTable).toHaveBeenCalledWith('sso_providers');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain(`UPDATE ${escapedName}`);
  });

  it('is a no-op when the legacy table or signature column is absent', async () => {
    const query = vi.fn(async () => undefined);
    const queryRunner = {
      connection: {
        getMetadata: vi.fn(() => { throw new Error('legacy table is not entity-backed'); }),
        driver: { escape: (value: string) => `"${value}"` },
      },
      getTable: vi.fn(async () => undefined),
      query,
    } as any;

    await new UpgradeLegacySamlSignatures1700000000065().up(queryRunner);

    expect(query).not.toHaveBeenCalled();
  });

  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'adds atomic external-registration identities portably on %s',
    async (database) => {
      const escape = (value: string) => database === 'mysql' ? `\`${value}\`` : database === 'mssql' ? `[${value}]` : `"${value}"`;
      const columns: TableColumn[] = [
        new TableColumn({ name: 'id', type: 'text', isNullable: false }),
        new TableColumn({ name: 'external_id', type: 'text', isNullable: false }),
      ];
      const uniques: any[] = [];
      const indices: any[] = [];
      const query = vi.fn(async (sql: string) => sql.startsWith('SELECT') ? [{
        ...(database === 'oracle'
          ? { ID: 'registration-1', ENGINE_ID: 'engine-1', EXTERNAL_ID: 'cluster/prod', REGISTRATION_SOURCE: 'external_api', API_CLIENT_ID: 'client-1', EXTERNAL_SYSTEM_ID: null, LIFECYCLE_STATUS: 'active' }
          : { id: 'registration-1', engine_id: 'engine-1', external_id: 'cluster/prod', registration_source: 'external_api', api_client_id: 'client-1', external_system_id: null, lifecycle_status: 'active' }),
      }] : undefined);
      const runnerForMigration = {
        connection: {
          options: { type: database },
          getMetadata: vi.fn(() => ({ tablePath: 'main.external_engine_registrations' })),
          driver: {
            escape,
            createParameter: (_name: string, index: number) => database === 'postgres' ? `$${index + 1}` : `:p${index}`,
            createFullType: (column: TableColumn) => column.length ? `${column.type}(${column.length})` : column.type,
          },
        },
        getTable: vi.fn(async () => ({ columns, uniques, indices })),
        hasColumn: vi.fn(async (_table: string, name: string) => columns.some((column) => column.name === name)),
        addColumn: vi.fn(async (_table: string, column: TableColumn) => { columns.push(column.clone()); }),
        changeColumn: vi.fn(async (_table: string, oldColumn: string | TableColumn, column: TableColumn) => {
          const name = typeof oldColumn === 'string' ? oldColumn : oldColumn.name;
          const index = columns.findIndex((candidate) => candidate.name === name);
          columns[index] = column.clone();
        }),
        updateDDL: vi.fn(async (sql: string) => {
          for (const name of ['source_identity', 'active_external_id_identity']) {
            if (sql.includes(name)) {
              const column = columns.find((candidate) => candidate.name === name);
              if (column) column.isNullable = false;
            }
          }
        }),
        createIndex: vi.fn(async (_table: string, index: any) => { indices.push(index); }),
        query,
      } as any;

      await new AddExternalEngineRegistrationIdentities1700000000108().up(runnerForMigration);

      expect(columns.find((column) => column.name === 'source_identity')).toMatchObject({ isNullable: false });
      expect(columns.find((column) => column.name === 'active_external_id_identity')).toMatchObject({ isNullable: false });
      expect(indices.map((index) => index.name)).toEqual([
        'uq_external_engine_registrations_source_identity',
        'uq_external_engine_registrations_active_external_identity',
      ]);
      expect(indices.every((index) => index.isUnique)).toBe(true);
      expect(query.mock.calls.some(([sql]) => String(sql).includes(`${escape('main')}.${escape('external_engine_registrations')}`))).toBe(true);
      expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE')).length).toBeGreaterThanOrEqual(3);
      if (database === 'spanner') expect(runnerForMigration.updateDDL).toHaveBeenCalledTimes(2);
    },
  );

  it('fails the external-registration identity upgrade with an actionable duplicate preflight', async () => {
    const queryRunner = {
      connection: {
        options: { type: 'postgres' },
        getMetadata: vi.fn(() => ({ tablePath: 'external_engine_registrations' })),
        driver: { escape: (value: string) => `"${value}"`, createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
      getTable: vi.fn(async () => ({
        columns: [
          new TableColumn({ name: 'source_identity', type: 'text', isNullable: true }),
          new TableColumn({ name: 'active_external_id_identity', type: 'text', isNullable: true }),
        ],
        uniques: [], indices: [],
      })),
      query: vi.fn(async (sql: string) => sql.startsWith('SELECT') ? [
        { id: 'one', engine_id: 'engine-1', external_id: 'duplicate', registration_source: 'external_api', api_client_id: 'client-1', external_system_id: null, lifecycle_status: 'active' },
        { id: 'two', engine_id: 'engine-2', external_id: 'duplicate', registration_source: 'external_api', api_client_id: 'client-2', external_system_id: null, lifecycle_status: 'active' },
      ] : undefined),
      hasColumn: vi.fn(async () => true),
    } as any;

    await expect(new AddExternalEngineRegistrationIdentities1700000000108().up(queryRunner))
      .rejects.toThrow('duplicate active externalId "duplicate"');
  });

  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'classifies and requires project ownership portably on %s',
    async (database) => {
      const escape = (name: string) => database === 'mysql' ? `\`${name}\`` : database === 'mssql' ? `[${name}]` : `"${name}"`;
      const tables = new Map<string, { columns: TableColumn[] }>([
        ['main.projects', { columns: [
          new TableColumn({ name: 'id', type: 'text', isNullable: false }),
          new TableColumn({ name: 'tenant_id', type: 'text', isNullable: true }),
        ] }],
        ['main.project_engine_targets', { columns: [
          new TableColumn({ name: 'id', type: 'text', isNullable: false }),
          new TableColumn({ name: 'project_id', type: 'text', isNullable: false }),
          new TableColumn({ name: 'tenant_id', type: 'text', isNullable: true }),
        ] }],
        ['main.role_assignments', { columns: [new TableColumn({ name: 'tenant_id', type: 'text', isNullable: true })] }],
        ['main.permission_grants', { columns: [new TableColumn({ name: 'tenant_id', type: 'text', isNullable: true })] }],
      ]);
      const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
        if (!sql.startsWith('SELECT')) return undefined;
        if (sql.includes('project_engine_targets')) {
          return database === 'oracle'
            ? [{ ID: 'target-1', PROJECT_ID: 'project-1', TENANT_ID: null }]
            : [{ id: 'target-1', project_id: 'project-1', tenant_id: null }];
        }
        if (sql.includes('role_assignments')) {
          return database === 'oracle'
            ? [{ ID: 'assignment-1', TENANT_ID: null, PRINCIPAL_TYPE: 'user', PRINCIPAL_ID: 'user-1', ROLE_ID: 'role-1', SCOPE_TYPE: 'project', SCOPE_ID: 'project-1', SOURCE: 'manual', SOURCE_REF: null, ASSIGNMENT_KEY: 'legacy-key' }]
            : [{ id: 'assignment-1', tenant_id: null, principal_type: 'user', principal_id: 'user-1', role_id: 'role-1', scope_type: 'project', scope_id: 'project-1', source: 'manual', source_ref: null, assignment_key: 'legacy-key' }];
        }
        if (sql.includes('permission_grants')) {
          return database === 'oracle'
            ? [{ ID: 'grant-1', TENANT_ID: null, RESOURCE_TYPE: 'project', RESOURCE_ID: 'project-1' }]
            : [{ id: 'grant-1', tenant_id: null, resource_type: 'project', resource_id: 'project-1' }];
        }
        return database === 'oracle'
          ? [{ ID: 'project-1', TENANT_ID: null }]
          : [{ id: 'project-1', tenant_id: null }];
      });
      const migrationRunner = {
        connection: {
          options: { type: database },
          getMetadata: vi.fn((name: string) => ({ tablePath: ({
            Project: 'main.projects',
            ProjectEngineTarget: 'main.project_engine_targets',
            RbacRoleAssignment: 'main.role_assignments',
            PermissionGrant: 'main.permission_grants',
          } as Record<string, string>)[name] })),
          driver: {
            escape,
            createParameter: (_name: string, index: number) => database === 'postgres' ? `$${index + 1}` : `:p${index}`,
            createFullType: (column: TableColumn) => column.length ? `${column.type}(${column.length})` : column.type,
          },
        },
        getTable: vi.fn(async (name: string) => tables.get(name)),
        hasColumn: vi.fn(async (name: string, column: string) => tables.get(name)?.columns.some((candidate) => candidate.name === column)),
        changeColumn: vi.fn(async (name: string, oldColumn: TableColumn, nextColumn: TableColumn) => {
          const table = tables.get(name)!;
          const index = table.columns.findIndex((candidate) => candidate.name === oldColumn.name);
          table.columns[index] = nextColumn.clone();
        }),
        updateDDL: vi.fn(async (sql: string) => {
          const name = sql.includes('project_engine_targets') ? 'main.project_engine_targets' : 'main.projects';
          tables.get(name)!.columns.find((column) => column.name === 'tenant_id')!.isNullable = false;
        }),
        query,
      } as any;

      await new RequireProjectTenantOwnership1700000000109().up(migrationRunner);

      expect(tables.get('main.projects')!.columns.find((column) => column.name === 'tenant_id')).toMatchObject({ isNullable: false });
      expect(tables.get('main.project_engine_targets')!.columns.find((column) => column.name === 'tenant_id')).toMatchObject({ isNullable: false });
      const updates = query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE'));
      expect(updates.some(([, params]) => params?.[0] === 'tenant-default' && params?.[1] === 'project-1')).toBe(true);
      expect(updates.some(([, params]) => params?.[0] === 'tenant-default' && params?.[1] === 'target-1')).toBe(true);
      expect(updates.some(([, params]) => params?.[0] === 'tenant-default' && params?.[2] === 'assignment-1')).toBe(true);
      expect(updates.some(([, params]) => params?.[0] === 'tenant-default' && params?.[1] === 'grant-1')).toBe(true);
      if (database === 'spanner') expect(migrationRunner.updateDDL).toHaveBeenCalledTimes(2);
    },
  );

  it('blocks contradictory target ownership before changing project data', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('project_engine_targets')) return [{ id: 'target-1', project_id: 'project-1', tenant_id: 'tenant-b' }];
      if (sql.startsWith('SELECT')) return [{ id: 'project-1', tenant_id: 'tenant-a' }];
      return undefined;
    });
    const queryRunner = {
      connection: {
        options: { type: 'postgres' },
        getMetadata: vi.fn((name: string) => ({ tablePath: name === 'Project' ? 'projects' : name === 'ProjectEngineTarget' ? 'project_engine_targets' : name === 'RbacRoleAssignment' ? 'role_assignments' : 'permission_grants' })),
        driver: { escape: (name: string) => `"${name}"`, createParameter: (_name: string, index: number) => `$${index + 1}` },
      },
      getTable: vi.fn(async (name: string) => ['projects', 'project_engine_targets'].includes(name)
        ? { columns: [new TableColumn({ name: 'tenant_id', type: 'text', isNullable: true })] }
        : undefined),
      query,
    } as any;

    await expect(new RequireProjectTenantOwnership1700000000109().up(queryRunner))
      .rejects.toThrow('tenant does not match project');
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE'))).toBe(false);
  });
});
