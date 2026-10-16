import { Table, TableColumn, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function portableText(
  queryRunner: QueryRunner,
  length: 'key' | 'document' = 'key',
): { type: string; length?: string } {
  const database = queryRunner.connection.options?.type || 'postgres';
  if (database === 'mysql') return { type: 'varchar', length: length === 'key' ? '191' : '4000' };
  if (database === 'mssql') return { type: 'nvarchar', length: length === 'key' ? '191' : '4000' };
  if (database === 'oracle') return { type: 'varchar2', length: length === 'key' ? '191' : '4000' };
  if (database === 'spanner') return { type: 'string', length: length === 'key' ? '191' : '4096' };
  return { type: 'text' };
}

function portableBoolean(
  queryRunner: QueryRunner,
): { type: string; precision?: number; scale?: number; default: boolean | number } {
  const database = queryRunner.connection.options?.type || 'postgres';
  if (database === 'mssql') return { type: 'bit', default: 1 };
  if (database === 'oracle') return { type: 'number', precision: 1, scale: 0, default: 1 };
  if (database === 'spanner') return { type: 'bool', default: true };
  return { type: 'boolean', default: true };
}

function portableBigint(
  queryRunner: QueryRunner,
): { type: string; precision?: number; scale?: number } {
  const database = queryRunner.connection.options?.type || 'postgres';
  if (database === 'oracle') return { type: 'number', precision: 19, scale: 0 };
  if (database === 'spanner') return { type: 'int64' };
  return { type: 'bigint' };
}

function portableInteger(queryRunner: QueryRunner): { type: string } {
  return {
    type: queryRunner.connection.options?.type === 'spanner' ? 'int64' : 'integer',
  };
}

function portableEmptyStringDefault(queryRunner: QueryRunner): string {
  return queryRunner.connection.options?.type === 'oracle'
    ? "'__enterpriseglue_empty__'"
    : "''";
}

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

function sqlTablePath(queryRunner: QueryRunner, tableName: string): string {
  return tableName
    .split('.')
    .map((part) => queryRunner.connection.driver.escape(part))
    .join('.');
}

async function addMissingColumns(
  queryRunner: QueryRunner,
  tableName: string,
  columns: TableColumn[],
): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) return;
  for (const column of columns) {
    if (!(await queryRunner.hasColumn(tableName, column.name))) {
      if (
        queryRunner.connection.options?.type === 'spanner'
        && !column.isNullable
      ) {
        const nullableColumn = column.clone();
        nullableColumn.isNullable = true;
        nullableColumn.default = undefined;
        await queryRunner.addColumn(tableName, nullableColumn);
      } else {
        await queryRunner.addColumn(tableName, column);
      }
    }
  }
}

async function requireSpannerColumns(
  queryRunner: QueryRunner,
  tableName: string,
  columnNames: string[],
): Promise<void> {
  if (queryRunner.connection.options?.type !== 'spanner') return;
  for (const columnName of columnNames) {
    const table = await queryRunner.getTable(tableName);
    const column = table?.findColumnByName(columnName);
    if (column?.isNullable) {
      const requiredColumn = column.clone();
      requiredColumn.isNullable = false;
      const columnType = queryRunner.connection.driver.createFullType(requiredColumn);
      await (queryRunner as QueryRunner & {
        updateDDL(sql: string): Promise<void>;
      }).updateDDL(
        `ALTER TABLE ${sqlTablePath(queryRunner, tableName)} ALTER COLUMN `
        + `${queryRunner.connection.driver.escape(columnName)} ${columnType} NOT NULL`,
      );
    }
  }
}

async function createIndexIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  index: TableIndex,
): Promise<void> {
  const table = await queryRunner.getTable(tableName);
  if (!table) return;
  if (!table.indices.some((candidate) => candidate.name === index.name)) {
    await queryRunner.createIndex(tableName, index);
  }
}

/**
 * Adds explicit dedicated/shared engine topology and the fail-closed mapping
 * metadata needed before shared-engine provisioning can be exposed.
 */
export class AddEngineTenancyFoundation1700000000096 implements MigrationInterface {
  name = 'AddEngineTenancyFoundation1700000000096';

  async up(queryRunner: QueryRunner): Promise<void> {
    const engines = tablePath(queryRunner, 'Engine', 'engines');
    const resources = tablePath(queryRunner, 'RuntimeResource', 'runtime_resources');
    const mappings = tablePath(queryRunner, 'EngineTenantMapping', 'engine_tenant_mappings');
    const keyText = portableText(queryRunner);
    const documentText = portableText(queryRunner, 'document');
    const activeBoolean = portableBoolean(queryRunner);
    const largeInteger = portableBigint(queryRunner);
    const integer = portableInteger(queryRunner);

    await addMissingColumns(queryRunner, engines, [
      new TableColumn({ name: 'tenancy_mode', ...keyText, default: "'dedicated'" }),
      new TableColumn({ name: 'tenant_mapping_strategy', ...keyText, isNullable: true }),
      new TableColumn({ name: 'tenant_mapping_version', ...integer, default: 0 }),
      new TableColumn({ name: 'tenant_resolution_status', ...keyText, default: "'migration_required'" }),
      new TableColumn({ name: 'last_tenant_reconciled_at', ...largeInteger, isNullable: true }),
    ]);

    if (await queryRunner.hasTable(engines)) {
      const resolutionStatus = queryRunner.connection.driver.escape('tenant_resolution_status');
      const tenantId = queryRunner.connection.driver.escape('tenant_id');
      if (queryRunner.connection.options?.type === 'spanner') {
        const tenancyMode = queryRunner.connection.driver.escape('tenancy_mode');
        const mappingVersion = queryRunner.connection.driver.escape('tenant_mapping_version');
        await queryRunner.query(
          `UPDATE ${sqlTablePath(queryRunner, engines)} SET `
          + `${tenancyMode} = COALESCE(${tenancyMode}, 'dedicated'), `
          + `${mappingVersion} = COALESCE(${mappingVersion}, 0), `
          + `${resolutionStatus} = CASE WHEN ${tenantId} IS NOT NULL THEN 'ready' ELSE 'migration_required' END `
          + `WHERE ${tenancyMode} IS NULL OR ${mappingVersion} IS NULL OR ${resolutionStatus} IS NULL`,
        );
        await requireSpannerColumns(queryRunner, engines, [
          'tenancy_mode',
          'tenant_mapping_version',
          'tenant_resolution_status',
        ]);
      }
      await queryRunner.query(
        `UPDATE ${sqlTablePath(queryRunner, engines)} SET ${resolutionStatus} = CASE WHEN ${tenantId} IS NOT NULL THEN 'ready' ELSE 'migration_required' END`
        + (queryRunner.connection.options?.type === 'spanner' ? ' WHERE TRUE' : ''),
      );
      await createIndexIfMissing(
        queryRunner,
        engines,
        new TableIndex({ name: 'idx_engines_tenancy_mode', columnNames: ['tenancy_mode'] }),
      );
      await createIndexIfMissing(
        queryRunner,
        engines,
        new TableIndex({ name: 'idx_engines_tenant_resolution_status', columnNames: ['tenant_resolution_status'] }),
      );
    }

    await addMissingColumns(queryRunner, resources, [
      new TableColumn({ name: 'tenant_resolution_status', ...keyText, default: "'unmapped'" }),
      new TableColumn({ name: 'tenant_mapping_id', ...keyText, isNullable: true }),
      new TableColumn({ name: 'tenant_mapping_version', ...integer, default: 0 }),
      new TableColumn({ name: 'tenant_resolution_details_json', ...documentText, default: "'{}'" }),
    ]);

    if (await queryRunner.hasTable(resources)) {
      const resolutionStatus = queryRunner.connection.driver.escape('tenant_resolution_status');
      const tenantId = queryRunner.connection.driver.escape('tenant_id');
      if (queryRunner.connection.options?.type === 'spanner') {
        const mappingVersion = queryRunner.connection.driver.escape('tenant_mapping_version');
        const resolutionDetails = queryRunner.connection.driver.escape('tenant_resolution_details_json');
        await queryRunner.query(
          `UPDATE ${sqlTablePath(queryRunner, resources)} SET `
          + `${mappingVersion} = COALESCE(${mappingVersion}, 0), `
          + `${resolutionDetails} = COALESCE(${resolutionDetails}, '{}'), `
          + `${resolutionStatus} = CASE WHEN ${tenantId} IS NOT NULL THEN 'resolved' ELSE 'unmapped' END `
          + `WHERE ${mappingVersion} IS NULL OR ${resolutionDetails} IS NULL OR ${resolutionStatus} IS NULL`,
        );
        await requireSpannerColumns(queryRunner, resources, [
          'tenant_resolution_status',
          'tenant_mapping_version',
          'tenant_resolution_details_json',
        ]);
      }
      await queryRunner.query(
        `UPDATE ${sqlTablePath(queryRunner, resources)} SET ${resolutionStatus} = CASE WHEN ${tenantId} IS NOT NULL THEN 'resolved' ELSE 'unmapped' END`
        + (queryRunner.connection.options?.type === 'spanner' ? ' WHERE TRUE' : ''),
      );
      await createIndexIfMissing(
        queryRunner,
        resources,
        new TableIndex({
          name: 'idx_runtime_resources_tenant_resolution',
          columnNames: ['engine_id', 'tenant_resolution_status'],
        }),
      );
    }

    if (!(await queryRunner.hasTable(mappings))) {
      await queryRunner.createTable(new Table({
        name: mappings,
        columns: [
          { name: 'id', ...keyText, isPrimary: true },
          { name: 'engine_id', ...keyText },
          { name: 'external_tenant_id', ...keyText, default: portableEmptyStringDefault(queryRunner) },
          { name: 'enterprise_tenant_id', ...keyText },
          { name: 'strategy', ...keyText },
          { name: 'source', ...keyText, default: "'manual'" },
          { name: 'source_ref', ...keyText },
          { name: 'ownership_mode', ...keyText, default: "'manual'" },
          { name: 'source_hash', ...keyText, isNullable: true },
          { name: 'last_applied_at', ...largeInteger, isNullable: true },
          { name: 'is_active', ...activeBoolean },
          { name: 'created_at', ...largeInteger },
          { name: 'updated_at', ...largeInteger },
        ],
        uniques: [
          new TableUnique({
            name: 'uq_engine_tenant_mappings_identity',
            columnNames: ['engine_id', 'strategy', 'external_tenant_id'],
          }),
          new TableUnique({
            name: 'uq_engine_tenant_mappings_source',
            columnNames: ['engine_id', 'source', 'source_ref'],
          }),
        ],
        indices: [
          new TableIndex({
            name: 'idx_engine_tenant_mappings_engine_active',
            columnNames: ['engine_id', 'is_active'],
          }),
          new TableIndex({
            name: 'idx_engine_tenant_mappings_enterprise_tenant',
            columnNames: ['enterprise_tenant_id'],
          }),
        ],
      }), true);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const engines = tablePath(queryRunner, 'Engine', 'engines');
    const resources = tablePath(queryRunner, 'RuntimeResource', 'runtime_resources');
    const mappings = tablePath(queryRunner, 'EngineTenantMapping', 'engine_tenant_mappings');

    if (await queryRunner.hasTable(mappings)) {
      await queryRunner.dropTable(mappings);
    }

    if (await queryRunner.hasTable(resources)) {
      const table = await queryRunner.getTable(resources);
      const resolutionIndex = table?.indices.find(
        (candidate) => candidate.name === 'idx_runtime_resources_tenant_resolution',
      );
      if (resolutionIndex) await queryRunner.dropIndex(resources, resolutionIndex);
      for (const name of [
        'tenant_resolution_details_json',
        'tenant_mapping_version',
        'tenant_mapping_id',
        'tenant_resolution_status',
      ]) {
        if (await queryRunner.hasColumn(resources, name)) {
          await queryRunner.dropColumn(resources, name);
        }
      }
    }

    if (await queryRunner.hasTable(engines)) {
      const table = await queryRunner.getTable(engines);
      for (const indexName of ['idx_engines_tenant_resolution_status', 'idx_engines_tenancy_mode']) {
        const index = table?.indices.find((candidate) => candidate.name === indexName);
        if (index) await queryRunner.dropIndex(engines, index);
      }
      for (const name of [
        'last_tenant_reconciled_at',
        'tenant_resolution_status',
        'tenant_mapping_version',
        'tenant_mapping_strategy',
        'tenancy_mode',
      ]) {
        if (await queryRunner.hasColumn(engines, name)) {
          await queryRunner.dropColumn(engines, name);
        }
      }
    }
  }
}
