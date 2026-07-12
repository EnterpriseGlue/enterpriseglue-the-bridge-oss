import { TableColumn, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { RbacRole } from '../../infrastructure/persistence/entities/RbacRole.js';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

function roleKeyIdentity(tenantId: string | null | undefined, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

/**
 * System role ids remain global because their tenant identity is `platform`.
 * Custom role keys become safely reusable by distinct EnterpriseGlue tenants.
 */
export class MakeRoleKeysTenantScoped1700000000050 implements MigrationInterface {
  name = 'MakeRoleKeysTenantScoped1700000000050';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRole', 'roles');
    const table = await queryRunner.getTable(tableName);
    if (!table) return;

    if (!table.columns.some((column) => column.name === 'role_key_identity')) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'role_key_identity', type: 'text', isNullable: true }));
    }

    const repo = queryRunner.manager.getRepository(RbacRole);
    for (const role of await repo.find()) {
      const identity = roleKeyIdentity(role.tenantId, role.key);
      if (role.roleKeyIdentity !== identity) await repo.update({ id: role.id }, { roleKeyIdentity: identity });
    }

    const refreshed = await queryRunner.getTable(tableName);
    if (!refreshed) return;
    const identityColumn = refreshed.columns.find((column) => column.name === 'role_key_identity');
    if (identityColumn?.isNullable) {
      await queryRunner.changeColumn(tableName, 'role_key_identity', new TableColumn({ name: 'role_key_identity', type: 'text', isNullable: false }));
    }
    const current = await queryRunner.getTable(tableName);
    if (!current) return;
    for (const unique of current.uniques.filter((candidate) => candidate.columnNames.length === 1 && candidate.columnNames[0] === 'key')) {
      await queryRunner.dropUniqueConstraint(tableName, unique);
    }
    if (!current.uniques.some((candidate) => candidate.name === 'uq_roles_key_identity')) {
      await queryRunner.createUniqueConstraint(tableName, new TableUnique({ name: 'uq_roles_key_identity', columnNames: ['role_key_identity'] }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'RbacRole', 'roles');
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    const scopedUnique = table.uniques.find((candidate) => candidate.name === 'uq_roles_key_identity');
    if (scopedUnique) await queryRunner.dropUniqueConstraint(tableName, scopedUnique);
    if (!table.uniques.some((candidate) => candidate.columnNames.length === 1 && candidate.columnNames[0] === 'key')) {
      await queryRunner.createUniqueConstraint(tableName, new TableUnique({ name: 'uq_roles_key', columnNames: ['key'] }));
    }
    if (await queryRunner.hasColumn(tableName, 'role_key_identity')) await queryRunner.dropColumn(tableName, 'role_key_identity');
  }
}
