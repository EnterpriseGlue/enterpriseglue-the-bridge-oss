import { createHash } from 'node:crypto';
import { TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { IdentityProvisioningCredential } from '../../infrastructure/persistence/entities/IdentityProvisioningCredential.js';
import { portableText } from './support/portable-columns.js';

function tablePath(queryRunner: QueryRunner): string {
  try { return queryRunner.connection.getMetadata('IdentityProvisioningCredential').tablePath; } catch { return 'identity_provisioning_credentials'; }
}

/** Adds durable at-most-once protection for reveal-once credential operations. */
export class AddProvisioningCredentialIdempotency1700000000113 implements MigrationInterface {
  name = 'AddProvisioningCredentialIdempotency1700000000113';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(tableName))) return;
    const key = portableText(queryRunner, 'key');
    for (const column of [
      new TableColumn({ name: 'issuance_idempotency_key', ...key, isNullable: true }),
      new TableColumn({ name: 'issuance_request_hash', ...key, isNullable: true }),
      new TableColumn({ name: 'issuance_idempotency_identity', ...key, isNullable: true }),
    ]) {
      if (!(await queryRunner.hasColumn(tableName, column.name))) await queryRunner.addColumn(tableName, column);
    }
    const repository = queryRunner.manager.getRepository(IdentityProvisioningCredential);
    const credentials = await repository.find({ select: { id: true, directoryId: true, issuanceIdempotencyIdentity: true } });
    for (const credential of credentials) {
      if (credential.issuanceIdempotencyIdentity) continue;
      const identity = createHash('sha256')
        .update(['identity-provisioning-credential-unkeyed-v1', credential.directoryId, credential.id].join('\u0000'))
        .digest('hex');
      await repository.update({ id: credential.id }, { issuanceIdempotencyIdentity: identity });
    }
    const withBackfill = await queryRunner.getTable(tableName);
    if (withBackfill?.findColumnByName('issuance_idempotency_identity')?.isNullable) {
      await queryRunner.changeColumn(tableName, 'issuance_idempotency_identity', new TableColumn({
        name: 'issuance_idempotency_identity', ...key, isNullable: false,
      }));
    }
    const table = await queryRunner.getTable(tableName);
    if (!table?.indices.some((index) => index.name === 'uq_identity_provisioning_credentials_idempotency')) {
      await queryRunner.createIndex(tableName, new TableIndex({
        name: 'uq_identity_provisioning_credentials_idempotency',
        columnNames: ['issuance_idempotency_identity'],
        isUnique: true,
      }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!(await queryRunner.hasTable(tableName))) return;
    const table = await queryRunner.getTable(tableName);
    if (table?.indices.some((index) => index.name === 'uq_identity_provisioning_credentials_idempotency')) {
      await queryRunner.dropIndex(tableName, 'uq_identity_provisioning_credentials_idempotency');
    }
    for (const column of ['issuance_idempotency_identity', 'issuance_request_hash', 'issuance_idempotency_key']) {
      if (await queryRunner.hasColumn(tableName, column)) await queryRunner.dropColumn(tableName, column);
    }
  }
}
