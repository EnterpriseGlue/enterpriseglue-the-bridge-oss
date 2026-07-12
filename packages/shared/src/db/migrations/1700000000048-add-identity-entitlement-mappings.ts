import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string { try { return queryRunner.connection.getMetadata(metadataName).tablePath; } catch { return fallback; } }
export class AddIdentityEntitlementMappings1700000000048 implements MigrationInterface {
  name = 'AddIdentityEntitlementMappings1700000000048';
  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'IdentityEntitlementMapping', 'identity_entitlement_mappings');
    if (await queryRunner.hasTable(tableName)) return;
    await queryRunner.createTable(new Table({ name: tableName, columns: [
      { name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true },
      { name: 'provider_id', type: 'text' }, { name: 'config_key', type: 'text', isNullable: true },
      { name: 'entitlement_type', type: 'text' }, { name: 'external_id', type: 'text', isNullable: true },
      { name: 'match_operator', type: 'text', default: "'exact'" }, { name: 'target_group_id', type: 'text' },
      { name: 'sync_mode', type: 'text', default: "'authoritative'" }, { name: 'is_active', type: 'boolean', default: true },
      { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' },
    ], indices: [
      new TableIndex({ name: 'idx_identity_entitlement_mapping_tenant', columnNames: ['tenant_id'] }),
      new TableIndex({ name: 'idx_identity_entitlement_mapping_provider', columnNames: ['provider_id'] }),
      new TableIndex({ name: 'idx_identity_entitlement_mapping_lookup', columnNames: ['provider_id', 'entitlement_type', 'is_active'] }),
      new TableIndex({ name: 'idx_identity_entitlement_mapping_group', columnNames: ['target_group_id'] }),
    ] }), true);
  }
  async down(queryRunner: QueryRunner): Promise<void> { const tableName = tablePath(queryRunner, 'IdentityEntitlementMapping', 'identity_entitlement_mappings'); if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName); }
}
