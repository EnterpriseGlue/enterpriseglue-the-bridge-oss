import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigRoleAssignmentOverrides1700000000070 implements MigrationInterface {
  name = 'AddConfigRoleAssignmentOverrides1700000000070';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = 'config_role_assignment_overrides';
    if (await queryRunner.hasTable(tableName)) return;

    await queryRunner.createTable(new Table({
      name: tableName,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'assignment_key', type: 'text' },
        { name: 'source_ref', type: 'text' },
        { name: 'removed_assignment_id', type: 'text' },
        { name: 'removed_by_id', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({ name: 'uq_config_role_assignment_override', columnNames: ['assignment_key', 'source_ref'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_config_role_assignment_override_source', columnNames: ['source_ref'] }),
      ],
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = 'config_role_assignment_overrides';
    if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName);
  }
}
