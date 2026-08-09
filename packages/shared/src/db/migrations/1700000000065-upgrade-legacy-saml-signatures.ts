import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

function escapeTablePath(queryRunner: QueryRunner, table: string): string {
  return table.split('.').map((part) => queryRunner.connection.driver.escape(part)).join('.');
}

/** Replaces legacy SHA-1 request-signing configuration with the secure default. */
export class UpgradeLegacySamlSignatures1700000000065 implements MigrationInterface {
  name = 'UpgradeLegacySamlSignatures1700000000065';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner, 'SsoProvider', 'sso_providers');
    const table = await queryRunner.getTable(tableName);
    if (!table?.findColumnByName('signature_algorithm')) return;

    // QueryRunner resolves an unqualified fallback against the configured
    // database/schema. Reuse that resolved name so the data update targets the
    // same table when the deployment does not use the default schema.
    const resolvedTableName = table.name;
    await queryRunner.query(
      `UPDATE ${escapeTablePath(queryRunner, resolvedTableName)}
       SET ${queryRunner.connection.driver.escape('signature_algorithm')} = 'sha256'
       WHERE ${queryRunner.connection.driver.escape('type')} = 'saml'
         AND ${queryRunner.connection.driver.escape('signature_algorithm')} = 'sha1'`,
    );
  }

  async down(): Promise<void> {
    // SHA-1 configuration must not be restored.
  }
}
