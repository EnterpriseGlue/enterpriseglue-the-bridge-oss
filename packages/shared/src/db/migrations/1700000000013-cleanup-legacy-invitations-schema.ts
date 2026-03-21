import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanupLegacyInvitationsSchema1700000000013 implements MigrationInterface {
  name = 'CleanupLegacyInvitationsSchema1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('Invitation').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      return;
    }

    const columns = [
      new TableColumn({ name: 'user_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'email', type: 'text', isNullable: true }),
      new TableColumn({ name: 'tenant_slug', type: 'text', isNullable: true }),
      new TableColumn({ name: 'resource_type', type: 'text', isNullable: true }),
      new TableColumn({ name: 'resource_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'resource_name', type: 'text', isNullable: true }),
      new TableColumn({ name: 'platform_role', type: 'text', isNullable: true }),
      new TableColumn({ name: 'resource_role', type: 'text', isNullable: true }),
      new TableColumn({ name: 'resource_roles_json', type: 'text', isNullable: true }),
      new TableColumn({ name: 'invite_token_hash', type: 'text', isNullable: true, isUnique: true }),
      new TableColumn({ name: 'one_time_password_hash', type: 'text', isNullable: true }),
      new TableColumn({ name: 'delivery_method', type: 'text', isNullable: true }),
      new TableColumn({ name: 'status', type: 'text', isNullable: true, default: queryRunner.connection.options.type === 'postgres' ? "'pending'" : "'pending'" }),
      new TableColumn({ name: 'expires_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'created_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'updated_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'created_by_user_id', type: 'text', isNullable: true }),
      new TableColumn({ name: 'otp_verified_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'completed_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'revoked_at', type: 'bigint', isNullable: true }),
      new TableColumn({ name: 'failed_attempts', type: queryRunner.connection.options.type === 'spanner' ? 'int64' : 'int', isNullable: true, default: '0' }),
      new TableColumn({ name: 'locked_until', type: 'bigint', isNullable: true }),
    ];

    for (const column of columns) {
      if (!(await queryRunner.hasColumn(tablePath, column.name))) {
        await queryRunner.addColumn(tablePath, column);
      }
    }

    const table = await queryRunner.getTable(tablePath);
    if (!table) {
      return;
    }

    const legacyNullableColumns = ['token', 'tenant_id', 'role', 'invited_by_user_id'];
    for (const columnName of legacyNullableColumns) {
      const existingColumn = table.columns.find((column) => column.name === columnName);
      if (existingColumn && !existingColumn.isNullable) {
        await queryRunner.changeColumn(tablePath, existingColumn, new TableColumn({
          ...existingColumn,
          isNullable: true,
        }));
      }
    }

    const refreshedTable = await queryRunner.getTable(tablePath);
    if (!refreshedTable) {
      return;
    }

    const indexes = [
      new TableIndex({ name: 'idx_invitations_user', columnNames: ['user_id'] }),
      new TableIndex({ name: 'idx_invitations_email', columnNames: ['email'] }),
      new TableIndex({ name: 'idx_invitations_token_hash', columnNames: ['invite_token_hash'] }),
      new TableIndex({ name: 'idx_invitations_status', columnNames: ['status'] }),
      new TableIndex({ name: 'idx_invitations_expires', columnNames: ['expires_at'] }),
    ];

    for (const index of indexes) {
      if (!refreshedTable.indices.some((existing) => existing.name === index.name)) {
        await queryRunner.createIndex(tablePath, index);
      }
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
