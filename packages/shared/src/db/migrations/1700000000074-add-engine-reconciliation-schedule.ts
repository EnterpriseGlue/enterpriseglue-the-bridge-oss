import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEngineReconciliationSchedule1700000000074 implements MigrationInterface {
  name = 'AddEngineReconciliationSchedule1700000000074';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('engines'))) return;
    const columns = [
      new TableColumn({ name: 'reconciliation_interval_seconds', type: 'integer', default: 300 }),
      new TableColumn({ name: 'last_metadata_reconciled_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'last_metadata_reconciliation_status', type: 'text', isNullable: true }),
    ];
    for (const column of columns) {
      if (!(await queryRunner.hasColumn('engines', column.name))) await queryRunner.addColumn('engines', column);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('engines'))) return;
    for (const name of ['last_metadata_reconciliation_status', 'last_metadata_reconciled_at', 'reconciliation_interval_seconds']) {
      if (await queryRunner.hasColumn('engines', name)) await queryRunner.dropColumn('engines', name);
    }
  }
}
