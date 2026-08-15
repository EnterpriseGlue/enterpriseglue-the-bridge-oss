import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('RefreshToken').tablePath; } catch { return 'refresh_tokens'; }
}

async function addIndexIfMissing(queryRunner: QueryRunner, tableName: string, index: TableIndex): Promise<void> {
  const table = await queryRunner.getTable(tableName);
  if (!table?.indices.some((candidate) => candidate.name === index.name)) await queryRunner.createIndex(tableName, index);
}

/** Adds portable, indexed federation session lineage for targeted OIDC/SAML logout. */
export class AddFederatedSessionLineage1700000000112 implements MigrationInterface {
  name = 'AddFederatedSessionLineage1700000000112';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(table))) return;
    for (const column of [
      new TableColumn({ name: 'provider_subject_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'provider_session_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'provider_name_id_format', type: 'text', isNullable: true }),
    ]) {
      if (!(await queryRunner.hasColumn(table, column.name))) await queryRunner.addColumn(table, column);
    }
    await addIndexIfMissing(queryRunner, table, new TableIndex({
      name: 'idx_refresh_tokens_provider_subject',
      columnNames: ['identity_provider_id', 'provider_subject_id', 'revoked_at'],
    }));
    await addIndexIfMissing(queryRunner, table, new TableIndex({
      name: 'idx_refresh_tokens_provider_session',
      columnNames: ['identity_provider_id', 'provider_session_id', 'revoked_at'],
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(table))) return;
    const current = await queryRunner.getTable(table);
    for (const indexName of ['idx_refresh_tokens_provider_session', 'idx_refresh_tokens_provider_subject']) {
      if (current?.indices.some((index) => index.name === indexName)) await queryRunner.dropIndex(table, indexName);
    }
    for (const columnName of ['provider_name_id_format', 'provider_session_id', 'provider_subject_id']) {
      if (await queryRunner.hasColumn(table, columnName)) await queryRunner.dropColumn(table, columnName);
    }
  }
}
