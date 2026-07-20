import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ExternalIdentity is the sole persisted external-subject link. There are no
 * deployed legacy SSO accounts to preserve, so provider-specific user columns
 * are retired instead of being kept as fallback identity sources.
 */
export class DropLegacyUserIdentityColumns1700000000092 implements MigrationInterface {
  name = 'DropLegacyUserIdentityColumns1700000000092';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('users'))) return;
    const table = await queryRunner.getTable('users');
    if (!table) return;

    for (const column of ['entra_id', 'entra_email', 'google_id']) {
      if (table.columns.some((entry) => entry.name === column)) {
        await queryRunner.dropColumn(table, column);
      }
    }
  }

  async down(): Promise<void> {
    // Deliberately irreversible: ExternalIdentity is the supported link model.
  }
}
