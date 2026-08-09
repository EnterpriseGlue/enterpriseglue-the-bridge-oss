import { TableColumn, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

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
      await queryRunner.addColumn(tableName, new TableColumn({ name: 'provider_key_identity', type: 'text', isNullable: true }));
    }
    const providers = await queryRunner.query(`SELECT id, tenant_id, key, provider_key_identity FROM ${tableName}`) as Array<{
      id: string; tenant_id: string | null; key: string; provider_key_identity: string | null;
    }>;
    for (const provider of providers) {
      const identity = keyIdentity(provider.tenant_id, provider.key);
      if (provider.provider_key_identity === identity) continue;
      const identityParameter = queryRunner.connection.driver.createParameter('providerKeyIdentity', 0);
      const idParameter = queryRunner.connection.driver.createParameter('providerId', 1);
      await queryRunner.query(`UPDATE ${tableName} SET provider_key_identity = ${identityParameter} WHERE id = ${idParameter}`, [identity, provider.id]);
    }
    const refreshed = await queryRunner.getTable(tableName);
    if (!refreshed) return;
    if (refreshed.columns.find((column) => column.name === 'provider_key_identity')?.isNullable) {
      await queryRunner.changeColumn(tableName, 'provider_key_identity', new TableColumn({ name: 'provider_key_identity', type: 'text', isNullable: false }));
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
