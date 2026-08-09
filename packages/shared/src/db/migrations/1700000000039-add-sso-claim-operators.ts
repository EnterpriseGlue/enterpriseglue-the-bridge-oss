import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function tablePath(queryRunner: QueryRunner, metadataName: string, fallback: string): string {
  try {
    return queryRunner.connection.getMetadata(metadataName).tablePath;
  } catch {
    return fallback;
  }
}

async function addColumnIfMissing(queryRunner: QueryRunner, tableName: string): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) return;
  if (await queryRunner.hasColumn(tableName, 'claim_operator')) return;
  await queryRunner.addColumn(tableName, new TableColumn({
    name: 'claim_operator',
    type: 'text',
    isNullable: true,
  }));
}

async function dropColumnIfPresent(queryRunner: QueryRunner, tableName: string): Promise<void> {
  if (!(await queryRunner.hasTable(tableName))) return;
  if (!(await queryRunner.hasColumn(tableName, 'claim_operator'))) return;
  await queryRunner.dropColumn(tableName, 'claim_operator');
}

export class AddSsoClaimOperators1700000000039 implements MigrationInterface {
  name = 'AddSsoClaimOperators1700000000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addColumnIfMissing(queryRunner, tablePath(queryRunner, 'SsoClaimsMapping', 'sso_claims_mappings'));
    await addColumnIfMissing(queryRunner, tablePath(queryRunner, 'SsoGroupMapping', 'sso_group_mappings'));
    await addColumnIfMissing(queryRunner, tablePath(queryRunner, 'SsoAssignmentMapping', 'sso_assignment_mappings'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await dropColumnIfPresent(queryRunner, tablePath(queryRunner, 'SsoAssignmentMapping', 'sso_assignment_mappings'));
    await dropColumnIfPresent(queryRunner, tablePath(queryRunner, 'SsoGroupMapping', 'sso_group_mappings'));
    await dropColumnIfPresent(queryRunner, tablePath(queryRunner, 'SsoClaimsMapping', 'sso_claims_mappings'));
  }
}
