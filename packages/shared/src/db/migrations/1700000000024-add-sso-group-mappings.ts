import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function createTableIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
  if (!(await queryRunner.hasTable(table.name))) {
    await queryRunner.createTable(table, true);
  }
}

export class AddSsoGroupMappings1700000000024 implements MigrationInterface {
  name = 'AddSsoGroupMappings1700000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const mappings = tablePath(queryRunner, 'SsoGroupMapping', 'sso_group_mappings');

    await createTableIfMissing(queryRunner, new Table({
      name: mappings,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'provider_id', type: 'text', isNullable: true },
        { name: 'claim_type', type: 'text' },
        { name: 'claim_key', type: 'text' },
        { name: 'claim_value', type: 'text' },
        { name: 'target_group_id', type: 'text' },
        { name: 'sync_mode', type: 'text', default: "'authoritative'" },
        { name: 'priority', type: 'integer', default: 0 },
        { name: 'is_active', type: 'boolean', default: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'idx_sso_group_mappings_tenant', columnNames: ['tenant_id'] }),
        new TableIndex({ name: 'idx_sso_group_mappings_provider', columnNames: ['provider_id'] }),
        new TableIndex({ name: 'idx_sso_group_mappings_active', columnNames: ['is_active'] }),
        new TableIndex({ name: 'idx_sso_group_mappings_lookup', columnNames: ['claim_type', 'claim_key', 'is_active'] }),
        new TableIndex({ name: 'idx_sso_group_mappings_group', columnNames: ['target_group_id'] }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const mappings = tablePath(queryRunner, 'SsoGroupMapping', 'sso_group_mappings');
    if (await queryRunner.hasTable(mappings)) {
      await queryRunner.dropTable(mappings);
    }
  }
}
