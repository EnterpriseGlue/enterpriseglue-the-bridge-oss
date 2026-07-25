import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('IdentityEntitlementMapping').tablePath; } catch { return 'identity_entitlement_mappings'; }
}

/** Makes configuration ownership explicit while preserving existing source-ref locks. */
export class AddIdentityMappingOwnershipMode1700000000104 implements MigrationInterface {
  name = 'AddIdentityMappingOwnershipMode1700000000104';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    if (!await queryRunner.hasColumn(tableName, 'ownership_mode')) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'ownership_mode', type: 'text', default: "'manual'" }));
    }
    await queryRunner.query(`UPDATE ${tableName} SET ownership_mode = 'config_locked' WHERE source_ref IS NOT NULL AND (ownership_mode IS NULL OR ownership_mode = 'manual')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (await queryRunner.hasTable(tableName) && await queryRunner.hasColumn(tableName, 'ownership_mode')) {
      await queryRunner.dropColumn(tableName, 'ownership_mode');
    }
  }
}
