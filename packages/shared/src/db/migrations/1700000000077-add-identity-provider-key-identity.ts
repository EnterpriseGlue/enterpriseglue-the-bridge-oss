import { TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn, requireExistingColumn, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('IdentityProvider').tablePath; } catch { return 'identity_providers'; }
}

function keyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

/** Makes global and tenant-scoped provider keys unique on every supported SQL backend. */
export class AddIdentityProviderKeyIdentity1700000000077 implements MigrationInterface {
  name = 'AddIdentityProviderKeyIdentity1700000000077';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (!table.columns.some((column) => column.name === 'provider_key_identity')) {
      await queryRunner.addColumn(tableName, portableColumn(queryRunner, { name: 'provider_key_identity', type: 'text', isNullable: true }));
    }
    const column = (name: string) => sqlIdentifier(queryRunner, name);
    const tableRef = sqlTablePath(queryRunner, tableName);
    const selected = ['id', 'tenant_id', 'key', 'provider_key_identity'].map(column).join(', ');
    const providers = await queryRunner.query(`SELECT ${selected} FROM ${tableRef}`) as Array<{
      id: string; tenant_id: string | null; key: string; provider_key_identity: string | null;
    }>;
    for (const provider of providers) {
      const identity = keyIdentity(provider.tenant_id, provider.key);
      if (provider.provider_key_identity === identity) continue;
      const identityParameter = queryRunner.connection.driver.createParameter('providerKeyIdentity', 0);
      const idParameter = queryRunner.connection.driver.createParameter('providerId', 1);
      await queryRunner.query(`UPDATE ${tableRef} SET ${column('provider_key_identity')} = ${identityParameter} WHERE ${column('id')} = ${idParameter}`, [identity, provider.id]);
    }
    const refreshed = await queryRunner.getTable(tableName);
    if (!refreshed) return;
    if (refreshed.columns.find((column) => column.name === 'provider_key_identity')?.isNullable) {
      await requireExistingColumn(queryRunner, tableName, 'provider_key_identity');
    }
    const current = await queryRunner.getTable(tableName);
    if (!current || current.uniques.some((unique) => unique.name === 'uq_identity_providers_key_identity') || current.indices.some((index) => index.name === 'uq_identity_providers_key_identity')) return;
    await queryRunner.createUniqueConstraint(tableName, new TableUnique({ name: 'uq_identity_providers_key_identity', columnNames: ['provider_key_identity'] }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    const unique = table.uniques.find((candidate) => candidate.name === 'uq_identity_providers_key_identity');
    if (unique) await queryRunner.dropUniqueConstraint(tableName, unique);
    if (await queryRunner.hasColumn(tableName, 'provider_key_identity')) await queryRunner.dropColumn(tableName, 'provider_key_identity');
  }
}
