import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the durable one-time-projection marker. The projection itself runs
 * after migrations through the normal data source, where all authorization
 * entity metadata is registered.
 */
export class FinalizeLegacyRoleAssignmentProjections1700000000091 implements MigrationInterface {
  name = 'FinalizeLegacyRoleAssignmentProjections1700000000091';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('authz_migration_states')) return;
    await queryRunner.createTable(new Table({
      name: 'authz_migration_states',
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'key', type: 'text', isUnique: true },
        { name: 'completed_at', type: 'bigint' },
        { name: 'details', type: 'text', isNullable: true },
      ],
    }), true);
  }

  async down(): Promise<void> {
    // Deliberately irreversible: the marker prevents replaying projections.
  }
}
