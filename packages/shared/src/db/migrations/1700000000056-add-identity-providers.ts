import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdentityProviders1700000000056 implements MigrationInterface {
  name = 'AddIdentityProviders1700000000056';
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('identity_providers')) return;
    await queryRunner.createTable(new Table({ name: 'identity_providers', columns: [
      { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true },
      { name: 'key', type: 'text' }, { name: 'protocol', type: 'text' }, { name: 'is_enabled', type: 'boolean', default: false },
      { name: 'authentication_mode', type: 'text', default: "'claims_only'" }, { name: 'directory_tenant_id', type: 'text', isNullable: true },
      { name: 'configuration_json', type: 'text', default: "'{}'" }, { name: 'sync_json', type: 'text', default: "'{}'" },
      { name: 'ownership_mode', type: 'text', default: "'manual'" }, { name: 'source_ref', type: 'text', isNullable: true },
      { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' },
    ], uniques: [new TableUnique({ name: 'uq_identity_providers_tenant_key', columnNames: ['tenant_id', 'key'] })], indices: [
      new TableIndex({ name: 'idx_identity_providers_tenant', columnNames: ['tenant_id'] }),
      new TableIndex({ name: 'idx_identity_providers_protocol_enabled', columnNames: ['protocol', 'is_enabled'] }),
    ] }), true);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('identity_providers')) await queryRunner.dropTable('identity_providers');
  }
}
