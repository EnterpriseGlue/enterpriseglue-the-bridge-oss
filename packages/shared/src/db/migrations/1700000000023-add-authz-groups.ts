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

export class AddAuthzGroups1700000000023 implements MigrationInterface {
  name = 'AddAuthzGroups1700000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const groups = tablePath(queryRunner, 'AuthzGroup', 'authz_groups');
    const memberships = tablePath(queryRunner, 'AuthzGroupMembership', 'authz_group_memberships');

    await createTableIfMissing(queryRunner, new Table({
      name: groups,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'key', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'description', type: 'text', isNullable: true },
        { name: 'source', type: 'text', default: "'manual'" },
        { name: 'source_ref', type: 'text', isNullable: true },
        { name: 'is_system', type: 'boolean', default: false },
        { name: 'is_archived', type: 'boolean', default: false },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({ name: 'uq_authz_groups_tenant_key', columnNames: ['tenant_id', 'key'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_authz_groups_tenant', columnNames: ['tenant_id'] }),
        new TableIndex({ name: 'idx_authz_groups_source', columnNames: ['source', 'source_ref'] }),
      ],
    }));

    await createTableIfMissing(queryRunner, new Table({
      name: memberships,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'group_id', type: 'text' },
        { name: 'user_id', type: 'text' },
        { name: 'source', type: 'text', default: "'manual'" },
        { name: 'source_ref', type: 'text', isNullable: true },
        { name: 'expires_at', type: 'bigint', isNullable: true },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({
          name: 'uq_authz_group_memberships_identity',
          columnNames: ['group_id', 'user_id', 'source', 'source_ref'],
        }),
      ],
      indices: [
        new TableIndex({ name: 'idx_authz_group_memberships_tenant', columnNames: ['tenant_id'] }),
        new TableIndex({ name: 'idx_authz_group_memberships_group', columnNames: ['group_id'] }),
        new TableIndex({ name: 'idx_authz_group_memberships_user', columnNames: ['user_id'] }),
        new TableIndex({ name: 'idx_authz_group_memberships_source', columnNames: ['source', 'source_ref'] }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      tablePath(queryRunner, 'AuthzGroupMembership', 'authz_group_memberships'),
      tablePath(queryRunner, 'AuthzGroup', 'authz_groups'),
    ];

    for (const table of tables) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
