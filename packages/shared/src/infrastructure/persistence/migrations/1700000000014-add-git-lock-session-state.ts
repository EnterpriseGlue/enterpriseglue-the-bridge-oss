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

    const quote = (identifier: string): string => queryRunner.connection.driver.escape(identifier);
    const quotedTable = tablePath
      .split('.')
      .map((segment) => quote(segment))
      .join('.');
    const lastInteractionAt = quote('last_interaction_at');
    const visibilityState = quote('visibility_state');
    const visibilityChangedAt = quote('visibility_changed_at');
    const heartbeatAt = quote('heartbeat_at');
    const acquiredAt = quote('acquired_at');

    const now = Date.now();
    await queryRunner.query(
      `UPDATE ${quotedTable} SET ${lastInteractionAt} = COALESCE(${lastInteractionAt}, ${heartbeatAt}, ${acquiredAt}, ${now})`
    );
    await queryRunner.query(
      `UPDATE ${quotedTable} SET ${visibilityState} = COALESCE(${visibilityState}, 'visible')`
    );
    await queryRunner.query(
      `UPDATE ${quotedTable} SET ${visibilityChangedAt} = COALESCE(${visibilityChangedAt}, ${heartbeatAt}, ${acquiredAt}, ${now})`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
