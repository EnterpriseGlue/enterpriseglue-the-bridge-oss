import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

export class AddSamlAssertionReplays1700000000064 implements MigrationInterface {
  name = 'AddSamlAssertionReplays1700000000064';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'SamlAssertionReplay', 'saml_assertion_replays');
    if (await queryRunner.hasTable(tableName)) return;
    await queryRunner.createTable(new Table({
      name: tableName,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'provider_id', type: 'text' },
        { name: 'response_hash', type: 'text' },
        { name: 'expires_at', type: 'bigint' },
        { name: 'created_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'uq_saml_assertion_replays_provider_hash', columnNames: ['provider_id', 'response_hash'], isUnique: true }),
        new TableIndex({ name: 'idx_saml_assertion_replays_expiry', columnNames: ['expires_at'] }),
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'SamlAssertionReplay', 'saml_assertion_replays');
    if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName);
  }
}
