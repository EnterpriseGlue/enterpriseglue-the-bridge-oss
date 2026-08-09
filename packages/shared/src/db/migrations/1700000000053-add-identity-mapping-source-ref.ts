import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string { try { return queryRunner.connection.getMetadata(metadataName).tablePath; } catch { return fallback; } }
export class AddIdentityMappingSourceRef1700000000053 implements MigrationInterface {
  name = 'AddIdentityMappingSourceRef1700000000053';
  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'IdentityEntitlementMapping', 'identity_entitlement_mappings');
    if ((await queryRunner.hasTable(tableName)) && !(await queryRunner.hasColumn(tableName, 'source_ref'))) await queryRunner.addColumn(tableName, new TableColumn({ name: 'source_ref', type: 'text', isNullable: true }));
  }
  async down(queryRunner: QueryRunner): Promise<void> { const tableName = tablePath(queryRunner, 'IdentityEntitlementMapping', 'identity_entitlement_mappings'); if ((await queryRunner.hasTable(tableName)) && await queryRunner.hasColumn(tableName, 'source_ref')) await queryRunner.dropColumn(tableName, 'source_ref'); }
}
