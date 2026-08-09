import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddEnginePipelineReceiptSetting1700000000060 implements MigrationInterface {
  name = 'AddEnginePipelineReceiptSetting1700000000060';
  async up(queryRunner: QueryRunner): Promise<void> { if (await queryRunner.hasTable('engines') && !(await queryRunner.hasColumn('engines', 'pipeline_receipt_enabled'))) await queryRunner.addColumn('engines', new TableColumn({ name: 'pipeline_receipt_enabled', type: 'boolean', default: true })); }
  async down(queryRunner: QueryRunner): Promise<void> { if (await queryRunner.hasTable('engines') && await queryRunner.hasColumn('engines', 'pipeline_receipt_enabled')) await queryRunner.dropColumn('engines', 'pipeline_receipt_enabled'); }
}
