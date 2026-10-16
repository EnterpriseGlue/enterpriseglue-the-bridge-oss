import { TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn } from './support/portable-columns.js';

export class RepairInvitationsLegacySchema1700000000012 implements MigrationInterface {
  name = 'RepairInvitationsLegacySchema1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('Invitation').tablePath;
    if (!(await queryRunner.hasTable(tablePath))) {
      return;
    }

    const columns = [
      portableColumn(queryRunner, { name: 'user_id', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'email', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'tenant_slug', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'resource_type', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'resource_id', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'resource_name', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'platform_role', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'resource_role', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'resource_roles_json', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'invite_token_hash', type: 'text', isNullable: true, isUnique: true }),
      portableColumn(queryRunner, { name: 'one_time_password_hash', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'delivery_method', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'status', type: 'text', isNullable: true, default: queryRunner.connection.options.type === 'postgres' ? "'pending'" : "'pending'" }),
      portableColumn(queryRunner, { name: 'expires_at', type: 'bigint', isNullable: true }),
      portableColumn(queryRunner, { name: 'created_at', type: 'bigint', isNullable: true }),
      portableColumn(queryRunner, { name: 'updated_at', type: 'bigint', isNullable: true }),
      portableColumn(queryRunner, { name: 'created_by_user_id', type: 'text', isNullable: true }),
      portableColumn(queryRunner, { name: 'otp_verified_at', type: 'bigint', isNullable: true }),
      portableColumn(queryRunner, { name: 'completed_at', type: 'bigint', isNullable: true }),
      portableColumn(queryRunner, { name: 'revoked_at', type: 'bigint', isNullable: true }),
      portableColumn(queryRunner, { name: 'failed_attempts', type: queryRunner.connection.options.type === 'spanner' ? 'int64' : 'int', isNullable: true, default: '0' }),
      portableColumn(queryRunner, { name: 'locked_until', type: 'bigint', isNullable: true }),
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

    const indexes = [
      new TableIndex({ name: 'idx_invitations_user', columnNames: ['user_id'] }),
      new TableIndex({ name: 'idx_invitations_email', columnNames: ['email'] }),
      new TableIndex({ name: 'idx_invitations_status', columnNames: ['status'] }),
      new TableIndex({ name: 'idx_invitations_expires', columnNames: ['expires_at'] }),
    ];

    for (const index of indexes) {
      if (!table.indices.some((existing) => existing.name === index.name)) {
        await queryRunner.createIndex(tablePath, index);
      }
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
  }
}
