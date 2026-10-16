import { TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('IdentityEntitlementMapping').tablePath; } catch { return 'identity_entitlement_mappings'; }
}

function keyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

/** Uniquely identifies config-managed identity mappings while leaving manual mappings unkeyed. */
export class AddIdentityMappingConfigKeyIdentity1700000000080 implements MigrationInterface {
  name = 'AddIdentityMappingConfigKeyIdentity1700000000080';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (!table.columns.some((column) => column.name === 'config_key_identity')) {
      await queryRunner.addColumn(tableName, portableColumn(queryRunner, { name: 'config_key_identity', type: 'text', isNullable: true }));
    }
    const column = (name: string) => sqlIdentifier(queryRunner, name);
    const tableRef = sqlTablePath(queryRunner, tableName);
    const selected = ['id', 'tenant_id', 'config_key', 'config_key_identity'].map(column).join(', ');
    const mappings = await queryRunner.query(`SELECT ${selected} FROM ${tableRef}`) as Array<{
      id: string; tenant_id: string | null; config_key: string | null; config_key_identity: string | null;
    }>;
    for (const mapping of mappings) {
      const identity = mapping.config_key ? keyIdentity(mapping.tenant_id, mapping.config_key) : null;
      if (mapping.config_key_identity === identity) continue;
      const identityParameter = queryRunner.connection.driver.createParameter('configKeyIdentity', 0);
      const idParameter = queryRunner.connection.driver.createParameter('mappingId', 1);
      await queryRunner.query(`UPDATE ${tableRef} SET ${column('config_key_identity')} = ${identityParameter} WHERE ${column('id')} = ${idParameter}`, [identity, mapping.id]);
    }
    const current = await queryRunner.getTable(tableName);
    if (!current || current.uniques.some((candidate) => candidate.name === 'uq_identity_entitlement_mapping_config_key_identity') || current.indices.some((candidate) => candidate.name === 'uq_identity_entitlement_mapping_config_key_identity')) return;
    await queryRunner.createUniqueConstraint(tableName, new TableUnique({ name: 'uq_identity_entitlement_mapping_config_key_identity', columnNames: ['config_key_identity'] }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    const unique = table.uniques.find((candidate) => candidate.name === 'uq_identity_entitlement_mapping_config_key_identity');
    if (unique) await queryRunner.dropUniqueConstraint(tableName, unique);
    if (await queryRunner.hasColumn(tableName, 'config_key_identity')) await queryRunner.dropColumn(tableName, 'config_key_identity');
  }
}
