import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

async function addColumnIfMissing(queryRunner: QueryRunner, tablePath: string, column: TableColumn): Promise<void> {
  if (!(await queryRunner.hasColumn(tablePath, column.name))) {
    await queryRunner.addColumn(tablePath, column);
  }
}

export class AddExternalEngineRegistration1700000000017 implements MigrationInterface {
  name = 'AddExternalEngineRegistration1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const engineTablePath = queryRunner.connection.getMetadata('Engine').tablePath;
    if (await queryRunner.hasTable(engineTablePath)) {
      await addColumnIfMissing(queryRunner, engineTablePath, new TableColumn({ name: 'external_id', type: 'text', isNullable: true }));
      await addColumnIfMissing(queryRunner, engineTablePath, new TableColumn({ name: 'labels_json', type: 'text', isNullable: true }));
      await addColumnIfMissing(queryRunner, engineTablePath, new TableColumn({ name: 'registration_source', type: 'text', isNullable: true }));
      await addColumnIfMissing(queryRunner, engineTablePath, new TableColumn({ name: 'external_updated_at', type: 'bigint', isNullable: true }));

      const engineTable = await queryRunner.getTable(engineTablePath);
      if (!engineTable?.indices.some((index) => index.name === 'idx_engines_external_id')) {
        await queryRunner.createIndex(engineTablePath, new TableIndex({
          name: 'idx_engines_external_id',
          columnNames: ['external_id'],
        }));
      }
    }

    const ssoAssignmentTablePath = queryRunner.connection.getMetadata('SsoAssignmentMapping').tablePath;
    if (await queryRunner.hasTable(ssoAssignmentTablePath)) {
      await addColumnIfMissing(queryRunner, ssoAssignmentTablePath, new TableColumn({ name: 'target_external_engine_id', type: 'text', isNullable: true }));
      await addColumnIfMissing(queryRunner, ssoAssignmentTablePath, new TableColumn({ name: 'target_label_key', type: 'text', isNullable: true }));
      await addColumnIfMissing(queryRunner, ssoAssignmentTablePath, new TableColumn({ name: 'target_label_value', type: 'text', isNullable: true }));
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
