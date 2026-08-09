import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuntimeResourceSetConfigProvenance1700000000072 implements MigrationInterface {
  name = 'AddRuntimeResourceSetConfigProvenance1700000000072';
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('runtime_resource_sets')) return;
    for (const [name, type] of [['source_hash', 'text'], ['last_applied_at', 'bigint'], ['drift_status', 'text']] as const) {
      if (!await queryRunner.hasColumn('runtime_resource_sets', name)) await queryRunner.addColumn('runtime_resource_sets', new TableColumn({ name, type, isNullable: true }));
    }
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('runtime_resource_sets')) return;
    for (const name of ['drift_status', 'last_applied_at', 'source_hash']) if (await queryRunner.hasColumn('runtime_resource_sets', name)) await queryRunner.dropColumn('runtime_resource_sets', name);
  }
}
