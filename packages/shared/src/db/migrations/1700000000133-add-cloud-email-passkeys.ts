import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CloudEmailSignup } from '../../infrastructure/persistence/entities/CloudEmailSignup.js';
import { CloudPasskey } from '../../infrastructure/persistence/entities/CloudPasskey.js';
import { CloudPasskeyChallenge } from '../../infrastructure/persistence/entities/CloudPasskeyChallenge.js';
import { portableBigint, portableText } from './support/portable-columns.js';

export class AddCloudEmailPasskeys1700000000133 implements MigrationInterface {
  name = 'AddCloudEmailPasskeys1700000000133';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const document = portableText(queryRunner, 'document');
    const timestamp = portableBigint(queryRunner);
    const signups = queryRunner.connection.getMetadata(CloudEmailSignup).tablePath;
    const passkeys = queryRunner.connection.getMetadata(CloudPasskey).tablePath;
    const challenges = queryRunner.connection.getMetadata(CloudPasskeyChallenge).tablePath;
    if (!await queryRunner.hasTable(signups)) await queryRunner.createTable(new Table({ name: signups, columns: [
      { name: 'id', ...key, isPrimary: true },
      { name: 'email', ...document },
      { name: 'email_hash', ...key },
      { name: 'token_hash', ...key },
      { name: 'expires_at', ...timestamp },
      { name: 'challenge', ...key, isNullable: true },
      { name: 'challenge_expires_at', ...timestamp, isNullable: true },
      { name: 'created_at', ...timestamp },
      { name: 'updated_at', ...timestamp },
    ], indices: [
      new TableIndex({ name: 'uq_cloud_email_signups_email_hash', columnNames: ['email_hash'], isUnique: true }),
      new TableIndex({ name: 'uq_cloud_email_signups_token', columnNames: ['token_hash'], isUnique: true }),
      new TableIndex({ name: 'idx_cloud_email_signups_expires', columnNames: ['expires_at'] }),
    ] }), true);
    if (!await queryRunner.hasTable(passkeys)) await queryRunner.createTable(new Table({ name: passkeys, columns: [
      { name: 'id', ...key, isPrimary: true },
      { name: 'user_id', ...key },
      { name: 'credential_id', ...document },
      { name: 'credential_id_hash', ...key },
      { name: 'public_key', ...document },
      { name: 'counter', ...timestamp },
      { name: 'transports_json', ...document },
      { name: 'created_at', ...timestamp },
      { name: 'last_used_at', ...timestamp, isNullable: true },
      { name: 'revoked_at', ...timestamp, isNullable: true },
    ], indices: [
      new TableIndex({ name: 'uq_cloud_passkeys_credential_hash', columnNames: ['credential_id_hash'], isUnique: true }),
      new TableIndex({ name: 'idx_cloud_passkeys_user', columnNames: ['user_id'] }),
    ] }), true);
    if (!await queryRunner.hasTable(challenges)) await queryRunner.createTable(new Table({ name: challenges, columns: [
      { name: 'id', ...key, isPrimary: true },
      { name: 'token_hash', ...key },
      { name: 'challenge', ...key },
      { name: 'expires_at', ...timestamp },
      { name: 'created_at', ...timestamp },
    ], indices: [
      new TableIndex({ name: 'uq_cloud_passkey_challenges_token', columnNames: ['token_hash'], isUnique: true }),
      new TableIndex({ name: 'idx_cloud_passkey_challenges_expires', columnNames: ['expires_at'] }),
    ] }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const passkeys = queryRunner.connection.getMetadata(CloudPasskey).tablePath;
    if (await queryRunner.hasTable(passkeys)) {
      if (await queryRunner.manager.getRepository(CloudPasskey).count() > 0) {
        throw new Error('Refusing to remove passkey credentials while Cloud accounts may depend on them');
      }
    }
    for (const entity of [CloudPasskeyChallenge, CloudPasskey, CloudEmailSignup]) {
      const table = queryRunner.connection.getMetadata(entity).tablePath;
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
