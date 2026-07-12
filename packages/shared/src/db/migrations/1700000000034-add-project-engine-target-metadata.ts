import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addColumnIfMissing(queryRunner: QueryRunner, table: string, column: TableColumn): Promise<void> {
  if (!(await queryRunner.hasColumn(table, column.name))) {
    await queryRunner.addColumn(table, column);
  }
}

export class AddProjectEngineTargetMetadata1700000000034 implements MigrationInterface {
  name = 'AddProjectEngineTargetMetadata1700000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const targets = tablePath(queryRunner, 'ProjectEngineTarget', 'project_engine_targets');
    if (!(await queryRunner.hasTable(targets))) return;

    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'external_system_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'external_project_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'external_engine_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'external_target_id', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'approval_status', type: 'text', default: "'not_required'" }));
    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'approved_at', type: 'bigint', isNullable: true }));
    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'policy_tags_json', type: 'text', isNullable: true }));
    await addColumnIfMissing(queryRunner, targets, new TableColumn({ name: 'diagnostics_json', type: 'text', isNullable: true }));

    const table = await queryRunner.getTable(targets);
    if (table && !table.indices.some((index) => index.name === 'idx_project_engine_targets_external')) {
      await queryRunner.createIndex(
        targets,
        new TableIndex({
          name: 'idx_project_engine_targets_external',
          columnNames: ['external_system_id', 'external_target_id'],
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const targets = tablePath(queryRunner, 'ProjectEngineTarget', 'project_engine_targets');
    if (!(await queryRunner.hasTable(targets))) return;

    const table = await queryRunner.getTable(targets);
    if (table?.indices.some((index) => index.name === 'idx_project_engine_targets_external')) {
      await queryRunner.dropIndex(targets, 'idx_project_engine_targets_external');
    }

    for (const column of [
      'diagnostics_json',
      'policy_tags_json',
      'approved_at',
      'approval_status',
      'external_target_id',
      'external_engine_id',
      'external_project_id',
      'external_system_id',
    ]) {
      if (await queryRunner.hasColumn(targets, column)) {
        await queryRunner.dropColumn(targets, column);
      }
    }
  }
}
