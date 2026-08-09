import { Table, TableIndex, TableUnique } from 'typeorm';
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

export class AddProjectEngineTargets1700000000026 implements MigrationInterface {
  name = 'AddProjectEngineTargets1700000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const targets = tablePath(queryRunner, 'ProjectEngineTarget', 'project_engine_targets');

    await createTableIfMissing(queryRunner, new Table({
      name: targets,
      columns: [
        { name: 'id', type: 'text', isPrimary: true },
        { name: 'tenant_id', type: 'text', isNullable: true },
        { name: 'project_id', type: 'text' },
        { name: 'engine_id', type: 'text' },
        { name: 'status', type: 'text', default: "'active'" },
        { name: 'source', type: 'text', default: "'manual'" },
        { name: 'source_ref', type: 'text', isNullable: true },
        { name: 'allow_manual_deploy', type: 'boolean', default: true },
        { name: 'allow_ci_deploy', type: 'boolean', default: false },
        { name: 'allow_api_deploy', type: 'boolean', default: false },
        { name: 'allow_import', type: 'boolean', default: true },
        { name: 'created_by_id', type: 'text', isNullable: true },
        { name: 'approved_by_id', type: 'text', isNullable: true },
        { name: 'last_seen_at', type: 'bigint', isNullable: true },
        { name: 'created_at', type: 'bigint' },
        { name: 'updated_at', type: 'bigint' },
      ],
      uniques: [
        new TableUnique({ name: 'uq_project_engine_targets_pair', columnNames: ['project_id', 'engine_id'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_project_engine_targets_tenant', columnNames: ['tenant_id'] }),
        new TableIndex({ name: 'idx_project_engine_targets_project', columnNames: ['project_id'] }),
        new TableIndex({ name: 'idx_project_engine_targets_engine', columnNames: ['engine_id'] }),
        new TableIndex({ name: 'idx_project_engine_targets_status', columnNames: ['status'] }),
        new TableIndex({ name: 'idx_project_engine_targets_source', columnNames: ['source', 'source_ref'] }),
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const targets = tablePath(queryRunner, 'ProjectEngineTarget', 'project_engine_targets');
    if (await queryRunner.hasTable(targets)) {
      await queryRunner.dropTable(targets);
    }
  }
}
