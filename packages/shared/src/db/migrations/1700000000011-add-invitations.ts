import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvitationsTable1700000000011 implements MigrationInterface {
  name = 'AddInvitationsTable1700000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('Invitation').tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: tablePath,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'user_id', type: 'text' },
          { name: 'email', type: 'text' },
          { name: 'tenant_slug', type: 'text' },
          { name: 'resource_type', type: 'text' },
          { name: 'resource_id', type: 'text', isNullable: true },
          { name: 'resource_name', type: 'text', isNullable: true },
          { name: 'platform_role', type: 'text', isNullable: true },
          { name: 'resource_role', type: 'text', isNullable: true },
          { name: 'resource_roles_json', type: 'text', isNullable: true },
          { name: 'invite_token_hash', type: 'text', isUnique: true },
          { name: 'one_time_password_hash', type: 'text' },
          { name: 'delivery_method', type: 'text' },
          { name: 'status', type: 'text', default: queryRunner.connection.options.type === 'postgres' ? "'pending'" : "'pending'" },
          { name: 'expires_at', type: 'bigint' },
          { name: 'created_at', type: 'bigint' },
          { name: 'updated_at', type: 'bigint' },
          { name: 'created_by_user_id', type: 'text', isNullable: true },
          { name: 'otp_verified_at', type: 'bigint', isNullable: true },
          { name: 'completed_at', type: 'bigint', isNullable: true },
          { name: 'revoked_at', type: 'bigint', isNullable: true },
          { name: 'failed_attempts', type: queryRunner.connection.options.type === 'spanner' ? 'int64' : 'int', default: '0' },
          { name: 'locked_until', type: 'bigint', isNullable: true },
        ],
      }),
      true
    );

    await queryRunner.createIndices(tablePath, [
      new TableIndex({ name: 'idx_invitations_user', columnNames: ['user_id'] }),
      new TableIndex({ name: 'idx_invitations_email', columnNames: ['email'] }),
      new TableIndex({ name: 'idx_invitations_token_hash', columnNames: ['invite_token_hash'] }),
      new TableIndex({ name: 'idx_invitations_status', columnNames: ['status'] }),
      new TableIndex({ name: 'idx_invitations_expires', columnNames: ['expires_at'] }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('Invitation').tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      await queryRunner.dropTable(tablePath);
    }
  }
}
