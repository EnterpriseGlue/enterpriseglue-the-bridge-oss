import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addRequiredColumnWithBackfill,
  portableStringDefault,
  portableText,
  sqlIdentifier,
  sqlStringLiteral,
  sqlTablePath,
} from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('IdentityEntitlementMapping').tablePath; } catch { return 'identity_entitlement_mappings'; }
}

/** Makes configuration ownership explicit while preserving existing source-ref locks. */
export class AddIdentityMappingOwnershipMode1700000000104 implements MigrationInterface {
  name = 'AddIdentityMappingOwnershipMode1700000000104';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    await addRequiredColumnWithBackfill(
      queryRunner,
      tableName,
      new TableColumn({
        name: 'ownership_mode',
        ...portableText(queryRunner, 'key'),
        default: portableStringDefault(queryRunner, 'manual'),
      }),
      sqlStringLiteral('manual'),
    );

    const escapedTable = sqlTablePath(queryRunner, tableName);
    const ownershipMode = sqlIdentifier(queryRunner, 'ownership_mode');
    const sourceRef = sqlIdentifier(queryRunner, 'source_ref');
    await queryRunner.query(
      `UPDATE ${escapedTable} SET ${ownershipMode} = ${sqlStringLiteral('config_locked')} `
      + `WHERE ${sourceRef} IS NOT NULL AND (${ownershipMode} IS NULL OR ${ownershipMode} = ${sqlStringLiteral('manual')})`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (await queryRunner.hasTable(tableName) && await queryRunner.hasColumn(tableName, 'ownership_mode')) {
      await queryRunner.dropColumn(tableName, 'ownership_mode');
    }
  }
}
