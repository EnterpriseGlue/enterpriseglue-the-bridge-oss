import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdentityReconciliationAndDeploymentReceipts1700000000057 implements MigrationInterface {
  name = 'AddIdentityReconciliationAndDeploymentReceipts1700000000057';
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('identity_reconciliation_checkpoints')) await queryRunner.createTable(new Table({ name: 'identity_reconciliation_checkpoints', columns: [
      { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true }, { name: 'provider_id', type: 'text' }, { name: 'cursor', type: 'text', isNullable: true }, { name: 'last_success_at', type: 'bigint', isNullable: true }, { name: 'lease_id', type: 'text', isNullable: true }, { name: 'lease_expires_at', type: 'bigint', isNullable: true }, { name: 'updated_at', type: 'bigint' },
    ], uniques: [new TableUnique({ name: 'uq_identity_reconciliation_checkpoint_provider', columnNames: ['provider_id'] })], indices: [new TableIndex({ name: 'idx_identity_reconciliation_checkpoint_lease', columnNames: ['lease_expires_at'] })] }), true);
    if (!await queryRunner.hasTable('deployment_receipts')) await queryRunner.createTable(new Table({ name: 'deployment_receipts', columns: [
      { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true }, { name: 'idempotency_key', type: 'text' }, { name: 'project_id', type: 'text' }, { name: 'engine_id', type: 'text' }, { name: 'engine_deployment_id', type: 'text' }, { name: 'source', type: 'text' }, { name: 'lineage_json', type: 'text', default: "'{}'" }, { name: 'received_at', type: 'bigint' },
    ], uniques: [new TableUnique({ name: 'uq_deployment_receipt_idempotency', columnNames: ['tenant_id', 'idempotency_key'] })], indices: [new TableIndex({ name: 'idx_deployment_receipt_engine', columnNames: ['engine_id', 'received_at'] })] }), true);
  }
  async down(queryRunner: QueryRunner): Promise<void> { if (await queryRunner.hasTable('deployment_receipts')) await queryRunner.dropTable('deployment_receipts'); if (await queryRunner.hasTable('identity_reconciliation_checkpoints')) await queryRunner.dropTable('identity_reconciliation_checkpoints'); }
}
