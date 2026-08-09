import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EnterpriseGlue has no deployed legacy SSO mappings. Direct identity-provider
 * entitlement mappings are the canonical authorization mapping model.
 */
export class DropLegacySsoMappingTables1700000000089 implements MigrationInterface {
  name = 'DropLegacySsoMappingTables1700000000089';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const tableName of ['sso_assignment_mappings', 'sso_group_mappings', 'sso_claims_mappings']) {
      if (await queryRunner.hasTable(tableName)) {
        await queryRunner.dropTable(tableName, true, true, true);
      }
    }
  }

  async down(): Promise<void> {
    // Deliberately irreversible: the retired tables are replaced by
    // identity_entitlement_mappings and have no supported conversion path.
  }
}
