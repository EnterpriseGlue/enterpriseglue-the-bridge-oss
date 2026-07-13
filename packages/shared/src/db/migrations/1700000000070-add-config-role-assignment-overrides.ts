import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddConfigRoleAssignmentOverrides1700000000070 implements MigrationInterface {
  name = 'AddConfigRoleAssignmentOverrides1700000000070';
  async up(q: QueryRunner): Promise<void> { if (await q.hasTable('config_role_assignment_overrides')) return; await q.createTable(new Table({ name: 'config_role_assignment_overrides', columns: [{ name: 'id', type: 'text', isPrimary: true }, { name: 'tenant_id', type: 'text', isNullable: true }, { name: 'assignment_key', type: 'text' }, { name: 'source_ref', type: 'text' }, { name: 'removed_assignment_id', type: 'text' }, { name: 'removed_by_id', type: 'text', isNullable: true }, { name: 'created_at', type: 'bigint' }, { name: 'updated_at', type: 'bigint' }], uniques: [{ name: 'uq_config_role_assignment_override', columnNames: ['assignment_key', 'source_ref'] }] })); }
  async down(q: QueryRunner): Promise<void> { if (await q.hasTable('config_role_assignment_overrides')) await q.dropTable('config_role_assignment_overrides'); }
}
