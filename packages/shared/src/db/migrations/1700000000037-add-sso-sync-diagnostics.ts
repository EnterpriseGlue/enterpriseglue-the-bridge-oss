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

export class AddSsoSyncDiagnostics1700000000037 implements MigrationInterface {
  name = 'AddSsoSyncDiagnostics1700000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const runs = tablePath(queryRunner, 'SsoSyncRun', 'sso_sync_runs');
    const events = tablePath(queryRunner, 'SsoSyncEvent', 'sso_sync_events');

    await createTableIfMissing(queryRunner, new Table({
      name: runs,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'provider_id', type: 'text', isNullable: true },
        { name: 'user_id', type: 'text', isNullable: true },
        { name: 'trigger', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'started_at', type: 'bigint' },
        { name: 'completed_at', type: 'bigint', isNullable: true },
        { name: 'group_memberships_created', type: 'integer', default: 0 },
        { name: 'group_memberships_updated', type: 'integer', default: 0 },
        { name: 'group_memberships_removed', type: 'integer', default: 0 },
        { name: 'assignments_created', type: 'integer', default: 0 },
        { name: 'assignments_updated', type: 'integer', default: 0 },
        { name: 'assignments_removed', type: 'integer', default: 0 },
        { name: 'error_code', type: 'text', isNullable: true },
        { name: 'error_message', type: 'text', isNullable: true },
        { name: 'details', type: 'text', default: "'{}'" },
      ],
      indices: [
        new TableIndex({ name: 'idx_sso_sync_runs_tenant', columnNames: ['tenant_id', 'started_at'] }),
        new TableIndex({ name: 'idx_sso_sync_runs_provider', columnNames: ['provider_id', 'started_at'] }),
        new TableIndex({ name: 'idx_sso_sync_runs_status', columnNames: ['status', 'started_at'] }),
        new TableIndex({ name: 'idx_sso_sync_runs_user', columnNames: ['user_id', 'started_at'] }),
      ],
    }));

    await createTableIfMissing(queryRunner, new Table({
      name: events,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'provider_id', type: 'text', isNullable: true },
        { name: 'run_id', type: 'text' },
        { name: 'severity', type: 'text' },
        { name: 'type', type: 'text' },
        { name: 'user_id', type: 'text', isNullable: true },
        { name: 'mapping_type', type: 'text', isNullable: true },
        { name: 'mapping_id', type: 'text', isNullable: true },
        { name: 'resource_type', type: 'text', isNullable: true },
        { name: 'resource_id', type: 'text', isNullable: true },
        { name: 'message', type: 'text' },
        { name: 'details', type: 'text', default: "'{}'" },
        { name: 'created_at', type: 'bigint' },
      ],
      indices: [
        new TableIndex({ name: 'idx_sso_sync_events_run', columnNames: ['run_id', 'created_at'] }),
        new TableIndex({ name: 'idx_sso_sync_events_tenant', columnNames: ['tenant_id', 'created_at'] }),
        new TableIndex({ name: 'idx_sso_sync_events_provider', columnNames: ['provider_id', 'created_at'] }),
        new TableIndex({ name: 'idx_sso_sync_events_severity', columnNames: ['severity', 'created_at'] }),
        new TableIndex({ name: 'idx_sso_sync_events_mapping', columnNames: ['mapping_type', 'mapping_id'] }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      tablePath(queryRunner, 'SsoSyncEvent', 'sso_sync_events'),
      tablePath(queryRunner, 'SsoSyncRun', 'sso_sync_runs'),
    ]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}
