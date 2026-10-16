import { TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn, requireExistingColumn, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('AuthzGroup').tablePath; } catch { return 'authz_groups'; }
}

function keyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

/** Makes global and tenant-scoped authorization group keys unique on every supported SQL backend. */
export class AddAuthzGroupKeyIdentity1700000000078 implements MigrationInterface {
  name = 'AddAuthzGroupKeyIdentity1700000000078';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (!table.columns.some((column) => column.name === 'group_key_identity')) {
      await queryRunner.addColumn(tableName, portableColumn(queryRunner, { name: 'group_key_identity', type: 'text', isNullable: true }));
    }
    const column = (name: string) => sqlIdentifier(queryRunner, name);
    const tableRef = sqlTablePath(queryRunner, tableName);
    const selected = ['id', 'tenant_id', 'key', 'group_key_identity'].map(column).join(', ');
    const groups = await queryRunner.query(`SELECT ${selected} FROM ${tableRef}`) as Array<{
      id: string; tenant_id: string | null; key: string; group_key_identity: string | null;
    }>;
    for (const group of groups) {
      const identity = keyIdentity(group.tenant_id, group.key);
      if (group.group_key_identity === identity) continue;
      const identityParameter = queryRunner.connection.driver.createParameter('groupKeyIdentity', 0);
      const idParameter = queryRunner.connection.driver.createParameter('groupId', 1);
      await queryRunner.query(`UPDATE ${tableRef} SET ${column('group_key_identity')} = ${identityParameter} WHERE ${column('id')} = ${idParameter}`, [identity, group.id]);
    }
    const refreshed = await queryRunner.getTable(tableName);
    if (!refreshed) return;
    if (refreshed.columns.find((column) => column.name === 'group_key_identity')?.isNullable) {
      await requireExistingColumn(queryRunner, tableName, 'group_key_identity');
    }
    const current = await queryRunner.getTable(tableName);
    if (!current || current.uniques.some((unique) => unique.name === 'uq_authz_groups_key_identity') || current.indices.some((index) => index.name === 'uq_authz_groups_key_identity')) return;
    await queryRunner.createUniqueConstraint(tableName, new TableUnique({ name: 'uq_authz_groups_key_identity', columnNames: ['group_key_identity'] }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    const unique = table.uniques.find((candidate) => candidate.name === 'uq_authz_groups_key_identity');
    if (unique) await queryRunner.dropUniqueConstraint(tableName, unique);
    if (await queryRunner.hasColumn(tableName, 'group_key_identity')) await queryRunner.dropColumn(tableName, 'group_key_identity');
  }
}
