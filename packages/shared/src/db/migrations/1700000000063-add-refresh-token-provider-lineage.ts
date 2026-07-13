import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenProviderLineage1700000000063 implements MigrationInterface {
  name = 'AddRefreshTokenProviderLineage1700000000063';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasColumn('refresh_tokens', 'identity_provider_id')) {
      await queryRunner.addColumn('refresh_tokens', new TableColumn({ name: 'identity_provider_id', type: 'text', isNullable: true }));
    }
    const table = await queryRunner.getTable('refresh_tokens');
    if (table && !table.indices.some((index) => index.name === 'idx_refresh_tokens_identity_provider')) {
      await queryRunner.createIndex('refresh_tokens', new TableIndex({ name: 'idx_refresh_tokens_identity_provider', columnNames: ['identity_provider_id', 'revoked_at'] }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('refresh_tokens');
    if (table?.indices.some((index) => index.name === 'idx_refresh_tokens_identity_provider')) await queryRunner.dropIndex('refresh_tokens', 'idx_refresh_tokens_identity_provider');
    if (await queryRunner.hasColumn('refresh_tokens', 'identity_provider_id')) await queryRunner.dropColumn('refresh_tokens', 'identity_provider_id');
  }
}
