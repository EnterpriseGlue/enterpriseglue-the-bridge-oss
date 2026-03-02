import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPiiSettings1700000000005 implements MigrationInterface {
  name = 'AddPiiSettings1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('PlatformSettings').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      console.warn(`Migration ${this.name}: table "${tablePath}" not found; skipping.`);
      return;
    }

    const columns = [
      new TableColumn({ name: 'pii_regex_enabled', type: 'boolean', default: false }),
      new TableColumn({ name: 'pii_external_provider_enabled', type: 'boolean', default: false }),
      new TableColumn({ name: 'pii_external_provider_type', type: 'text', isNullable: true }),
      new TableColumn({ name: 'pii_external_provider_endpoint', type: 'text', isNullable: true }),
      new TableColumn({ name: 'pii_external_provider_auth_header', type: 'text', isNullable: true }),
      new TableColumn({ name: 'pii_external_provider_auth_token', type: 'text', isNullable: true }),
      new TableColumn({ name: 'pii_external_provider_project_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'pii_external_provider_region', type: 'text', isNullable: true }),
      new TableColumn({ name: 'pii_redaction_style', type: 'text', default: "'<TYPE>'" }),
      new TableColumn({
        name: 'pii_scopes',
        type: 'text',
        default: "'[\"processDetails\",\"history\",\"logs\",\"errors\",\"audit\"]'",
      }),
      new TableColumn({ name: 'pii_max_payload_size_bytes', type: 'integer', default: 262144 }),
    ];

    for (const column of columns) {
      const exists = await queryRunner.hasColumn(tablePath, column.name);
      if (!exists) {
        await queryRunner.addColumn(tablePath, column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('PlatformSettings').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      return;
    }
    const columnNames = [
      'pii_max_payload_size_bytes',
      'pii_scopes',
      'pii_redaction_style',
      'pii_external_provider_region',
      'pii_external_provider_project_id',
      'pii_external_provider_auth_token',
      'pii_external_provider_auth_header',
      'pii_external_provider_endpoint',
      'pii_external_provider_type',
      'pii_external_provider_enabled',
      'pii_regex_enabled',
    ];

    for (const name of columnNames) {
      const exists = await queryRunner.hasColumn(tablePath, name);
      if (exists) {
        await queryRunner.dropColumn(tablePath, name);
      }
    }
  }
}
