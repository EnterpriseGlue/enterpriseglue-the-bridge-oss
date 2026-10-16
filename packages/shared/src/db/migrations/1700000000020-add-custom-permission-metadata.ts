import { legacyBooleanColumn, portableColumn } from './support/portable-columns.js';
import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addColumnIfMissing(queryRunner: QueryRunner, tablePathName: string, column: TableColumn): Promise<void> {
  if (!(await queryRunner.hasColumn(tablePathName, column.name))) {
    await queryRunner.addColumn(tablePathName, column);
  }
}

export class AddCustomPermissionMetadata1700000000020 implements MigrationInterface {
  name = 'AddCustomPermissionMetadata1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = tablePath(queryRunner, 'RbacPermission', 'permissions');
    if (!(await queryRunner.hasTable(permissions))) return;

    await addColumnIfMissing(queryRunner, permissions, portableColumn(queryRunner, { name: 'kind', type: 'text', default: "'system'" }));
    await addColumnIfMissing(queryRunner, permissions, portableColumn(queryRunner, { name: 'is_editable', ...legacyBooleanColumn(queryRunner, false) }));
    await addColumnIfMissing(queryRunner, permissions, portableColumn(queryRunner, { name: 'is_archived', ...legacyBooleanColumn(queryRunner, false) }));
    await addColumnIfMissing(queryRunner, permissions, portableColumn(queryRunner, { name: 'created_by_id', type: 'text', isNullable: true }));
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
