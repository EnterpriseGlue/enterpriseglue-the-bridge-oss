import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

/** Adds durable provenance so config apply can safely distinguish role ownership. */
export class AddRoleSourceOwnership1700000000049 implements MigrationInterface {
  name = 'AddRoleSourceOwnership1700000000049';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRole', 'roles');
    if (!(await queryRunner.hasTable(tableName))) return;
    if (!(await queryRunner.hasColumn(tableName, 'source'))) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'source', type: 'text', default: "'manual'" }));
    }
    if (!(await queryRunner.hasColumn(tableName, 'source_ref'))) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'source_ref', type: 'text', isNullable: true }));
    }
    const table = await queryRunner.getTable(tableName);
    if (table && !table.indices.some((index) => index.name === 'idx_roles_source')) {
      await queryRunner.createIndex(tableName, new TableIndex({ name: 'idx_roles_source', columnNames: ['source', 'source_ref'] }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRole', 'roles');
    if (!(await queryRunner.hasTable(tableName))) return;
    const table = await queryRunner.getTable(tableName);
    const index = table?.indices.find((candidate) => candidate.name === 'idx_roles_source');
    if (index) await queryRunner.dropIndex(tableName, index);
    if (await queryRunner.hasColumn(tableName, 'source_ref')) await queryRunner.dropColumn(tableName, 'source_ref');
    if (await queryRunner.hasColumn(tableName, 'source')) await queryRunner.dropColumn(tableName, 'source');
  }
}
