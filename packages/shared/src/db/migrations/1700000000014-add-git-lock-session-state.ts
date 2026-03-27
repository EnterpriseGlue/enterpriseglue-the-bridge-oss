import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGitLockSessionState1700000000014 implements MigrationInterface {
  name = 'AddGitLockSessionState1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('GitLock').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      return;
    }

    const columns = [
      new TableColumn({ name: 'last_interaction_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'visibility_state', type: 'text', isNullable: true, default: "'visible'" }),
      new TableColumn({ name: 'visibility_changed_at', type: 'bigint', isNullable: true }),
    ];

    for (const column of columns) {
      if (!(await queryRunner.hasColumn(tablePath, column.name))) {
        await queryRunner.addColumn(tablePath, column);
      }
    }

    const now = Date.now();
    await queryRunner.query(
      `UPDATE ${tablePath} SET last_interaction_at = COALESCE(last_interaction_at, heartbeat_at, acquired_at, ${now})`
    );
    await queryRunner.query(
      `UPDATE ${tablePath} SET visibility_state = COALESCE(visibility_state, 'visible')`
    );
    await queryRunner.query(
      `UPDATE ${tablePath} SET visibility_changed_at = COALESCE(visibility_changed_at, heartbeat_at, acquired_at, ${now})`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
