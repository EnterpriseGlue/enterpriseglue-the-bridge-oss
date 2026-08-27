import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PluginInstallation,
  PluginTenantApplicationOperation,
  PluginTenantEnablement,
} from '../../infrastructure/persistence/entities/PluginPlatform.js';
import {
  addRequiredColumnWithBackfill,
  portableBigint,
  portableStringDefault,
  sqlStringLiteral,
  portableText,
} from './support/portable-columns.js';

const pathFor = (queryRunner: QueryRunner, entity: Function): string =>
  queryRunner.connection.getMetadata(entity).tablePath;

export class AddTenantApplicationMarketplace1700000000128
  implements MigrationInterface
{
  name = 'AddTenantApplicationMarketplace1700000000128';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const document = portableText(queryRunner, 'document');
    const timestamp = portableBigint(queryRunner);

    const installations = pathFor(queryRunner, PluginInstallation);
    const enablements = pathFor(queryRunner, PluginTenantEnablement);
    const installationTable = await queryRunner.getTable(installations);
    const enablementTable = await queryRunner.getTable(enablements);
    if (!installationTable || !enablementTable) {
      throw new Error('Plugin platform tables must exist before marketplace migration');
    }

    for (const column of [
      new TableColumn({ name: 'tenant_configuration_path', ...document, isNullable: true }),
      new TableColumn({ name: 'tenant_configuration_schema_sha256', ...key, isNullable: true }),
    ]) {
      if (!installationTable.findColumnByName(column.name)) {
        await queryRunner.addColumn(installations, column);
      }
    }

    await addRequiredColumnWithBackfill(
      queryRunner,
      enablements,
      new TableColumn({
        name: 'activation_request_state',
        ...key,
        default: portableStringDefault(queryRunner, 'none'),
      }),
      sqlStringLiteral('none'),
    );
    for (const column of [
      new TableColumn({ name: 'requested_by_ref', ...key, isNullable: true }),
      new TableColumn({ name: 'requested_at', ...timestamp, isNullable: true }),
      new TableColumn({ name: 'reviewed_by_ref', ...key, isNullable: true }),
      new TableColumn({ name: 'reviewed_at', ...timestamp, isNullable: true }),
    ]) {
      if (!enablementTable.findColumnByName(column.name)) {
        await queryRunner.addColumn(enablements, column);
      }
    }

    const operations = pathFor(queryRunner, PluginTenantApplicationOperation);
    if (!await queryRunner.hasTable(operations)) {
      await queryRunner.createTable(new Table({
        name: operations,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'plugin_id', ...key },
          { name: 'tenant_ref', ...key },
          { name: 'type', ...key },
          { name: 'idempotency_key_hash', ...key },
          { name: 'request_hash', ...key },
          { name: 'receipt_json', ...document },
          { name: 'actor_ref', ...key },
          { name: 'correlation_id', ...key },
          { name: 'created_at', ...timestamp },
        ],
        indices: [
          new TableIndex({
            name: 'idx_plugin_tenant_app_op_idempotency',
            columnNames: ['idempotency_key_hash'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'idx_plugin_tenant_app_op_scope',
            columnNames: ['plugin_id', 'tenant_ref', 'created_at'],
          }),
        ],
      }), true);
    }

  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const operations = pathFor(queryRunner, PluginTenantApplicationOperation);
    if (await queryRunner.hasTable(operations)) await queryRunner.dropTable(operations);

    const enablements = pathFor(queryRunner, PluginTenantEnablement);
    for (const name of [
      'reviewed_at',
      'reviewed_by_ref',
      'requested_at',
      'requested_by_ref',
      'activation_request_state',
    ]) {
      if (await queryRunner.hasColumn(enablements, name)) {
        await queryRunner.dropColumn(enablements, name);
      }
    }

    const installations = pathFor(queryRunner, PluginInstallation);
    for (const name of [
      'tenant_configuration_schema_sha256',
      'tenant_configuration_path',
    ]) {
      if (await queryRunner.hasColumn(installations, name)) {
        await queryRunner.dropColumn(installations, name);
      }
    }
  }
}
