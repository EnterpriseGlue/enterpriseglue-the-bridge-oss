import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try { return queryRunner.connection.getMetadata(metadataName).tablePath; } catch { return fallback; }
}

export class AddSsoProviderConfigOwnership1700000000052 implements MigrationInterface {
  name = 'AddSsoProviderConfigOwnership1700000000052';
  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'SsoProvider', 'sso_providers');
    if (!(await queryRunner.hasTable(tableName))) return;
    if (!(await queryRunner.hasColumn(tableName, 'config_key'))) await queryRunner.addColumn(tableName, new TableColumn({ name: 'config_key', type: 'text', isNullable: true }));
    if (!(await queryRunner.hasColumn(tableName, 'source_ref'))) await queryRunner.addColumn(tableName, new TableColumn({ name: 'source_ref', type: 'text', isNullable: true }));
    const table = await queryRunner.getTable(tableName);
    if (table && !table.indices.some((index) => index.name === 'idx_sso_providers_config_key')) await queryRunner.createIndex(tableName, new TableIndex({ name: 'idx_sso_providers_config_key', columnNames: ['config_key'] }));
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'SsoProvider', 'sso_providers');
    if (!(await queryRunner.hasTable(tableName))) return;
    const table = await queryRunner.getTable(tableName);
    const index = table?.indices.find((candidate) => candidate.name === 'idx_sso_providers_config_key');
    if (index) await queryRunner.dropIndex(tableName, index);
    if (await queryRunner.hasColumn(tableName, 'source_ref')) await queryRunner.dropColumn(tableName, 'source_ref');
    if (await queryRunner.hasColumn(tableName, 'config_key')) await queryRunner.dropColumn(tableName, 'config_key');
  }
}
