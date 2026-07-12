import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function createTableIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
  if (!(await queryRunner.hasTable(table.name))) {
    await queryRunner.createTable(table, true);
  }
}

export class AddRbacFoundation1700000000016 implements MigrationInterface {
  name = 'AddRbacFoundation1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = tablePath(queryRunner, 'RbacPermission', 'permissions');
    const roles = tablePath(queryRunner, 'RbacRole', 'roles');
    const rolePermissions = tablePath(queryRunner, 'RbacRolePermission', 'role_permissions');
    const roleAssignments = tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments');
    const ssoAssignmentMappings = tablePath(queryRunner, 'SsoAssignmentMapping', 'sso_assignment_mappings');

    await createTableIfMissing(queryRunner, new Table({
      name: permissions,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'key', type: 'text', isUnique: true },
        { name: 'scope', type: 'text' },
        { name: 'category', type: 'text' },
        { name: 'label', type: 'text' },
        { name: 'description', type: 'text', isNullable: true },
        { name: 'kind', type: 'text', default: "'system'" },
        { name: 'is_editable', type: 'boolean', default: false },
        { name: 'is_archived', type: 'boolean', default: false },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'idx_permissions_scope', columnNames: ['scope'] }),
        new TableIndex({ name: 'idx_permissions_category', columnNames: ['category'] }),
      ],
    }));

    await createTableIfMissing(queryRunner, new Table({
      name: roles,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'key', type: 'text', isUnique: true },
        { name: 'name', type: 'text' },
        { name: 'description', type: 'text', isNullable: true },
        { name: 'scope', type: 'text' },
        { name: 'kind', type: 'text' },
        { name: 'is_editable', type: 'boolean', default: false },
        { name: 'is_assignable', type: 'boolean', default: true },
        { name: 'is_archived', type: 'boolean', default: false },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'idx_roles_scope', columnNames: ['scope'] }),
        new TableIndex({ name: 'idx_roles_kind', columnNames: ['kind'] }),
      ],
    }));

    await createTableIfMissing(queryRunner, new Table({
      name: rolePermissions,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'role_id', type: 'text' },
        { name: 'permission_id', type: 'text' },
        { name: 'created_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({ name: 'uq_role_permissions_role_permission', columnNames: ['role_id', 'permission_id'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_role_permissions_role', columnNames: ['role_id'] }),
        new TableIndex({ name: 'idx_role_permissions_permission', columnNames: ['permission_id'] }),
      ],
    }));

    await createTableIfMissing(queryRunner, new Table({
      name: roleAssignments,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'user_id', type: 'text' },
        { name: 'principal_type', type: 'text', isNullable: true },
        { name: 'principal_id', type: 'text', isNullable: true },
        { name: 'role_id', type: 'text' },
        { name: 'resource_type', type: 'text', isNullable: true },
        { name: 'resource_id', type: 'text', isNullable: true },
        { name: 'scope_type', type: 'text', isNullable: true },
        { name: 'scope_id', type: 'text', isNullable: true },
        { name: 'source', type: 'text' },
        { name: 'source_mapping_id', type: 'text', isNullable: true },
        { name: 'source_ref', type: 'text', isNullable: true },
        { name: 'expires_at', type: 'bigint', isNullable: true },
        { name: 'last_seen_at', type: 'bigint', isNullable: true },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({
          name: 'uq_role_assignments_identity',
          columnNames: ['user_id', 'role_id', 'resource_type', 'resource_id', 'source', 'source_mapping_id'],
        }),
      ],
      indices: [
        new TableIndex({ name: 'idx_role_assignments_user', columnNames: ['user_id'] }),
        new TableIndex({ name: 'idx_role_assignments_principal', columnNames: ['principal_type', 'principal_id'] }),
        new TableIndex({ name: 'idx_role_assignments_resource', columnNames: ['resource_type', 'resource_id'] }),
        new TableIndex({ name: 'idx_role_assignments_scope', columnNames: ['scope_type', 'scope_id'] }),
        new TableIndex({ name: 'idx_role_assignments_source', columnNames: ['source', 'source_mapping_id'] }),
      ],
    }));

    await createTableIfMissing(queryRunner, new Table({
      name: ssoAssignmentMappings,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'provider_id', type: 'text', isNullable: true },
        { name: 'claim_type', type: 'text' },
        { name: 'claim_key', type: 'text' },
        { name: 'claim_value', type: 'text' },
        { name: 'target_scope', type: 'text', default: "'engine'" },
        { name: 'target_selector_type', type: 'text' },
        { name: 'target_engine_id', type: 'text', isNullable: true },
        { name: 'target_role_id', type: 'text' },
        { name: 'sync_mode', type: 'text', default: "'authoritative'" },
        { name: 'priority', type: 'integer', default: 0 },
        { name: 'is_active', type: 'boolean', default: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'idx_sso_assignment_provider', columnNames: ['provider_id'] }),
        new TableIndex({ name: 'idx_sso_assignment_active', columnNames: ['is_active'] }),
        new TableIndex({ name: 'idx_sso_assignment_lookup', columnNames: ['claim_type', 'claim_key', 'is_active'] }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      tablePath(queryRunner, 'SsoAssignmentMapping', 'sso_assignment_mappings'),
      tablePath(queryRunner, 'RbacRoleAssignment', 'role_assignments'),
      tablePath(queryRunner, 'RbacRolePermission', 'role_permissions'),
      tablePath(queryRunner, 'RbacRole', 'roles'),
      tablePath(queryRunner, 'RbacPermission', 'permissions'),
    ];

    for (const table of tables) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
