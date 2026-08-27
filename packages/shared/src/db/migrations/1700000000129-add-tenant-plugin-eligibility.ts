import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addRequiredColumnWithBackfill,
  portableBigint,
  portableStringDefault,
  portableText,
  sqlStringLiteral,
} from './support/portable-columns.js';

const pathFor = (queryRunner: QueryRunner, entityName: string, fallback: string): string => {
  try {
    return queryRunner.connection.getMetadata(entityName).tablePath;
  } catch {
    return fallback;
  }
};

export class AddTenantPluginEligibility1700000000129
  implements MigrationInterface
{
  name = 'AddTenantPluginEligibility1700000000129';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const document = portableText(queryRunner, 'document');
    const timestamp = portableBigint(queryRunner);
    const installations = pathFor(queryRunner, 'PluginInstallation', 'plugin_installations');

    await addRequiredColumnWithBackfill(
      queryRunner,
      installations,
      new TableColumn({
        name: 'entitlement_provider',
        ...key,
        default: portableStringDefault(queryRunner, 'none'),
      }),
      sqlStringLiteral('none'),
    );
    if (!await queryRunner.hasColumn(installations, 'entitlement_feature')) {
      await queryRunner.addColumn(
        installations,
        new TableColumn({ name: 'entitlement_feature', ...key, isNullable: true }),
      );
    }

    const eligibilities = pathFor(queryRunner, 'PluginTenantEligibility', 'plugin_tenant_eligibilities');
    if (!await queryRunner.hasTable(eligibilities)) {
      await queryRunner.createTable(new Table({
        name: eligibilities,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'plugin_id', ...key },
          { name: 'tenant_ref', ...key },
          { name: 'plugin_version', ...key },
          { name: 'release_digest', ...document },
          { name: 'state', ...key },
          { name: 'effective_from', ...timestamp, isNullable: true },
          { name: 'effective_until', ...timestamp, isNullable: true },
          { name: 'limits_hash', ...key },
          { name: 'projection_revision', ...timestamp },
          { name: 'issuer', ...document },
          { name: 'expires_at', ...timestamp },
          { name: 'projection_ref', ...key },
          { name: 'projection_id', ...key },
          { name: 'signature_sha256', ...key },
          { name: 'created_at', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        indices: [
          new TableIndex({
            name: 'idx_plugin_tenant_eligibility_identity',
            columnNames: ['plugin_id', 'tenant_ref'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'idx_plugin_tenant_eligibility_expiry',
            columnNames: ['expires_at'],
          }),
          new TableIndex({
            name: 'idx_plugin_tenant_eligibility_state',
            columnNames: ['state', 'effective_until'],
          }),
        ],
      }), true);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const eligibilities = pathFor(queryRunner, 'PluginTenantEligibility', 'plugin_tenant_eligibilities');
    if (await queryRunner.hasTable(eligibilities)) {
      await queryRunner.dropTable(eligibilities);
    }
    const installations = pathFor(queryRunner, 'PluginInstallation', 'plugin_installations');
    for (const name of ['entitlement_feature', 'entitlement_provider']) {
      if (await queryRunner.hasColumn(installations, name)) {
        await queryRunner.dropColumn(installations, name);
      }
    }
  }
}
