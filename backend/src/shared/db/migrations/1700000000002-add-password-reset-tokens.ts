import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetTokensTable1700000000002 implements MigrationInterface {
  name = 'AddPasswordResetTokensTable1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('PasswordResetToken').tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: tablePath,
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'user_id', type: 'text' },
          { name: 'token_hash', type: 'text', isUnique: true },
          { name: 'expires_at', type: 'bigint' },
          { name: 'created_at', type: 'bigint' },
          { name: 'consumed_at', type: 'bigint', isNullable: true },
        ],
      }),
      true
    );

    await queryRunner.createIndices(tablePath, [
      new TableIndex({ name: 'idx_password_reset_tokens_user', columnNames: ['user_id'] }),
      new TableIndex({ name: 'idx_password_reset_tokens_hash', columnNames: ['token_hash'] }),
      new TableIndex({ name: 'idx_password_reset_tokens_expires', columnNames: ['expires_at'] }),
      new TableIndex({ name: 'idx_password_reset_tokens_consumed', columnNames: ['consumed_at'] }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tablePath = queryRunner.connection.getMetadata('PasswordResetToken').tablePath;
    if (await queryRunner.hasTable(tablePath)) {
      await queryRunner.dropTable(tablePath);
    }
  }
}
