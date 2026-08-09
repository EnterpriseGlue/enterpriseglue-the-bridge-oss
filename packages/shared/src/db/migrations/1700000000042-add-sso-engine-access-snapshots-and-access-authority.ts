import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addColumnIfMissing(queryRunner: QueryRunner, table: string, column: TableColumn): Promise<void> {
  if (!(await queryRunner.hasColumn(table, column.name))) {
    await queryRunner.addColumn(table, column);
  }
}

export class AddSsoEngineAccessSnapshotsAndAccessAuthority1700000000042 implements MigrationInterface {
  name = 'AddSsoEngineAccessSnapshotsAndAccessAuthority1700000000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const snapshotTable = tablePath(queryRunner, 'SsoEngineAccessSnapshot', 'sso_engine_access_snapshots');
    if (!(await queryRunner.hasTable(snapshotTable))) {
      await queryRunner.createTable(new Table({
        name: snapshotTable,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text', isNullable: true },
          { name: 'provider_id', type: 'text', isNullable: true },
          { name: 'mapping_id', type: 'text' },
          { name: 'principal_type', type: 'text' },
          { name: 'principal_id', type: 'text' },
          { name: 'engine_id', type: 'text' },
          { name: 'provider_subject_ids_json', type: 'text', default: "'[]'" },
          { name: 'provider_group_ids_json', type: 'text', default: "'[]'" },
          { name: 'provider_app_role_ids_json', type: 'text', default: "'[]'" },
          { name: 'current_role_ids_json', type: 'text', default: "'[]'" },
          { name: 'previous_role_ids_json', type: 'text', default: "'[]'" },
          { name: 'status', type: 'text' },
          { name: 'cleanup_reason', type: 'text', isNullable: true },
          { name: 'last_seen_at', type: 'bigint' },
          { name: 'last_synced_at', type: 'bigint' },
          { name: 'removed_at', type: 'bigint', isNullable: true },
          { name: 'details', type: 'text', default: "'{}'" },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
        ],
        indices: [
          new TableIndex({ name: 'idx_sso_engine_access_snapshots_engine', columnNames: ['engine_id', 'status'] }),
          new TableIndex({ name: 'idx_sso_engine_access_snapshots_principal', columnNames: ['principal_type', 'principal_id'] }),
          new TableIndex({ name: 'idx_sso_engine_access_snapshots_mapping', columnNames: ['mapping_id'] }),
          new TableIndex({ name: 'idx_sso_engine_access_snapshots_provider', columnNames: ['provider_id'] }),
          new TableIndex({ name: 'idx_sso_engine_access_snapshots_status', columnNames: ['status'] }),
          new TableIndex({ name: 'idx_sso_engine_access_snapshots_sync', columnNames: ['last_synced_at'] }),
        ],
      }), true);
    }

    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (!(await queryRunner.hasTable(settingsTable))) return;

    await addColumnIfMissing(queryRunner, settingsTable, new TableColumn({
      name: 'engine_access_authority',
      type: 'text',
      default: "'manual'",
    }));
    await addColumnIfMissing(queryRunner, settingsTable, new TableColumn({
      name: 'project_access_authority',
      type: 'text',
      default: "'manual'",
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const settingsTable = tablePath(queryRunner, 'PlatformSettings', 'platform_settings');
    if (await queryRunner.hasTable(settingsTable)) {
      for (const column of ['project_access_authority', 'engine_access_authority']) {
        if (await queryRunner.hasColumn(settingsTable, column)) {
          await queryRunner.dropColumn(settingsTable, column);
        }
      }
    }

    const snapshotTable = tablePath(queryRunner, 'SsoEngineAccessSnapshot', 'sso_engine_access_snapshots');
    if (await queryRunner.hasTable(snapshotTable)) {
      await queryRunner.dropTable(snapshotTable);
    }
  }
}
