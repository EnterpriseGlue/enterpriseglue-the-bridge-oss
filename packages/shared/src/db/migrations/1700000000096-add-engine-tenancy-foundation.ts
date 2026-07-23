import { Table, TableColumn, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addMissingColumns(
  queryRunner: QueryRunner,
  tableName: string,
  columns: TableColumn[],
): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) return;
  for (const column of columns) {
    if (!(await queryRunner.hasColumn(tableName, column.name))) {
      await queryRunner.addColumn(tableName, column);
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

    await addMissingColumns(queryRunner, engines, [
      new TableColumn({ name: 'tenancy_mode', type: 'text', default: "'dedicated'" }),
      new TableColumn({ name: 'tenant_mapping_strategy', type: 'text', isNullable: true }),
      new TableColumn({ name: 'tenant_mapping_version', type: 'integer', default: 0 }),
      new TableColumn({ name: 'tenant_resolution_status', type: 'text', default: "'migration_required'" }),
      new TableColumn({ name: 'last_tenant_reconciled_at', type: 'bigint', isNullable: true }),
    ]);

    if (await queryRunner.hasTable(engines)) {
      await queryRunner.query(
        `UPDATE ${engines} SET tenant_resolution_status = CASE WHEN tenant_id IS NOT NULL THEN 'ready' ELSE 'migration_required' END`,
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
      new TableColumn({ name: 'tenant_resolution_status', type: 'text', default: "'unmapped'" }),
      new TableColumn({ name: 'tenant_mapping_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'tenant_mapping_version', type: 'integer', default: 0 }),
      new TableColumn({ name: 'tenant_resolution_details_json', type: 'text', default: "'{}'" }),
    ]);

    if (await queryRunner.hasTable(resources)) {
      await queryRunner.query(
        `UPDATE ${resources} SET tenant_resolution_status = CASE WHEN tenant_id IS NOT NULL THEN 'resolved' ELSE 'unmapped' END`,
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
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'engine_id', type: 'text' },
          { name: 'external_tenant_id', type: 'text', default: "''" },
          { name: 'enterprise_tenant_id', type: 'text' },
          { name: 'strategy', type: 'text' },
          { name: 'source', type: 'text', default: "'manual'" },
          { name: 'source_ref', type: 'text' },
          { name: 'ownership_mode', type: 'text', default: "'manual'" },
          { name: 'source_hash', type: 'text', isNullable: true },
          { name: 'last_applied_at', type: 'bigint', isNullable: true },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
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
