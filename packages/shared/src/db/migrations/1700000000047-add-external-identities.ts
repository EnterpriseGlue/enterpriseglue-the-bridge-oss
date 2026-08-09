import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try { return queryRunner.connection.getMetadata(metadataName).tablePath; } catch { return fallback; }
}

export class AddExternalIdentities1700000000047 implements MigrationInterface {
  name = 'AddExternalIdentities1700000000047';
  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'ExternalIdentity', 'external_identities');
    if (await queryRunner.hasTable(tableName)) return;
    await queryRunner.createTable(new Table({ name: tableName, columns: [
      { name: 'id', type: 'text', isPrimary: true }, { name: 'identity_key', type: 'text' },
      { name: 'tenant_id', type: 'text', isNullable: true }, { name: 'provider_id', type: 'text' },
      { name: 'provider_type', type: 'text' }, { name: 'subject_id', type: 'text' },
      { name: 'directory_tenant_id', type: 'text', isNullable: true }, { name: 'user_id', type: 'text' },
      { name: 'email_hint', type: 'text', isNullable: true }, { name: 'status', type: 'text', default: "'active'" },
      { name: 'linked_at', type: 'bigint' }, { name: 'last_seen_at', type: 'bigint' },
      { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' },
    ], uniques: [new TableUnique({ name: 'uq_external_identities_key', columnNames: ['identity_key'] })], indices: [
      new TableIndex({ name: 'idx_external_identities_tenant_provider_subject', columnNames: ['tenant_id', 'provider_id', 'subject_id'] }),
      new TableIndex({ name: 'idx_external_identities_user', columnNames: ['user_id'] }),
      new TableIndex({ name: 'idx_external_identities_provider_status', columnNames: ['provider_id', 'status'] }),
    ] }), true);
  }
  async down(queryRunner: QueryRunner): Promise<void> { const tableName = tablePath(queryRunner, 'ExternalIdentity', 'external_identities'); if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName); }
}
