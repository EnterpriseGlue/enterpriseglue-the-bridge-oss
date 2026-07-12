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

export class AddSsoNormalizedIdentities1700000000038 implements MigrationInterface {
  name = 'AddSsoNormalizedIdentities1700000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const identities = tablePath(queryRunner, 'SsoNormalizedIdentity', 'sso_normalized_identities');

    await createTableIfMissing(queryRunner, new Table({
      name: identities,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'provider_id', type: 'text' },
        { name: 'provider_type', type: 'text' },
        { name: 'provider_subject', type: 'text' },
        { name: 'subject_claim', type: 'text', isNullable: true },
        { name: 'provider_tenant_id', type: 'text', isNullable: true },
        { name: 'user_id', type: 'text' },
        { name: 'email', type: 'text', isNullable: true },
        { name: 'display_name', type: 'text', isNullable: true },
        { name: 'first_name', type: 'text', isNullable: true },
        { name: 'last_name', type: 'text', isNullable: true },
        { name: 'groups_json', type: 'text', default: "'[]'" },
        { name: 'roles_json', type: 'text', default: "'[]'" },
        { name: 'claims_json', type: 'text', default: "'{}'" },
        { name: 'provider_status', type: 'text', default: "'active'" },
        { name: 'last_seen_at', type: 'bigint' },
        { name: 'last_provider_check_at', type: 'bigint', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'idx_sso_normalized_identities_tenant', columnNames: ['tenant_id'] }),
        new TableIndex({ name: 'idx_sso_normalized_identities_provider_subject', columnNames: ['provider_id', 'provider_subject'] }),
        new TableIndex({ name: 'idx_sso_normalized_identities_user', columnNames: ['user_id'] }),
        new TableIndex({ name: 'idx_sso_normalized_identities_status', columnNames: ['provider_status', 'last_seen_at'] }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const identities = tablePath(queryRunner, 'SsoNormalizedIdentity', 'sso_normalized_identities');
    if (await queryRunner.hasTable(identities)) {
      await queryRunner.dropTable(identities);
    }
  }
}
