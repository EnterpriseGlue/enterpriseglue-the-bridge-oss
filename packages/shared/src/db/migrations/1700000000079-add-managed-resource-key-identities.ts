import { TableColumn, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

type KeyedResource = {
  metadataName: string;
  fallbackTable: string;
  column: string;
  unique: string;
};

const RESOURCES: KeyedResource[] = [
  { metadataName: 'EngineSet', fallbackTable: 'engine_sets', column: 'engine_set_key_identity', unique: 'uq_engine_sets_key_identity' },
  { metadataName: 'RuntimeResourceSet', fallbackTable: 'runtime_resource_sets', column: 'runtime_resource_set_key_identity', unique: 'uq_runtime_resource_sets_key_identity' },
];

function tablePath(queryRunner: QueryRunner, resource: KeyedResource): string {
  try { return queryRunner.connection.getMetadata(resource.metadataName).tablePath; } catch { return resource.fallbackTable; }
}

function keyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

/** Makes tenant/global keys for config-managed Engine Set resources portable across SQL null-uniqueness semantics. */
export class AddManagedResourceKeyIdentities1700000000079 implements MigrationInterface {
  name = 'AddManagedResourceKeyIdentities1700000000079';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const resource of RESOURCES) {
      const tableName = tablePath(queryRunner, resource);
      const table = await queryRunner.getTable(tableName);
      if (!table) continue;
      if (!table.columns.some((column) => column.name === resource.column)) {
        await queryRunner.addColumn(tableName, new TableColumn({ name: resource.column, type: 'text', isNullable: true }));
      }
      const rows = await queryRunner.query(`SELECT id, tenant_id, key, ${resource.column} FROM ${tableName}`) as Array<{
        id: string; tenant_id: string | null; key: string;
      }>;
      for (const row of rows) {
        const identity = keyIdentity(row.tenant_id, row.key);
        const identityParameter = queryRunner.connection.driver.createParameter('keyIdentity', 0);
        const idParameter = queryRunner.connection.driver.createParameter('resourceId', 1);
        await queryRunner.query(`UPDATE ${tableName} SET ${resource.column} = ${identityParameter} WHERE id = ${idParameter}`, [identity, row.id]);
      }
      const refreshed = await queryRunner.getTable(tableName);
      if (!refreshed) continue;
      if (refreshed.columns.find((column) => column.name === resource.column)?.isNullable) {
        await queryRunner.changeColumn(tableName, resource.column, new TableColumn({ name: resource.column, type: 'text', isNullable: false }));
      }
      const current = await queryRunner.getTable(tableName);
      if (current && !current.uniques.some((candidate) => candidate.name === resource.unique) && !current.indices.some((candidate) => candidate.name === resource.unique)) {
        await queryRunner.createUniqueConstraint(tableName, new TableUnique({ name: resource.unique, columnNames: [resource.column] }));
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const resource of [...RESOURCES].reverse()) {
      const tableName = tablePath(queryRunner, resource);
      const table = await queryRunner.getTable(tableName);
      if (!table) continue;
      const unique = table.uniques.find((candidate) => candidate.name === resource.unique);
      if (unique) await queryRunner.dropUniqueConstraint(tableName, unique);
      if (await queryRunner.hasColumn(tableName, resource.column)) await queryRunner.dropColumn(tableName, resource.column);
    }
  }
}
