import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  portableBigint,
  portableStringDefault,
  portableText,
} from './support/portable-columns.js';

const pathFor = (queryRunner: QueryRunner, entityName: string, fallback: string): string => {
  try {
    return queryRunner.connection.getMetadata(entityName).tablePath;
  } catch {
    return fallback;
  }
};

export class AddTenantWorkloadLifecycle1700000000127 implements MigrationInterface {
  name = 'AddTenantWorkloadLifecycle1700000000127';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const document = portableText(queryRunner, 'document');
    const timestamp = portableBigint(queryRunner);
    const stringDefault = (value: string) => portableStringDefault(queryRunner, value);

    const aliases = pathFor(queryRunner, 'TenantRoutingAlias', 'tenant_routing_aliases');
    if (!await queryRunner.hasTable(aliases)) {
      await queryRunner.createTable(new Table({
        name: aliases,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'tenant_id', ...key },
          { name: 'hostname', ...key },
          { name: 'status', ...key, default: stringDefault('active') },
          { name: 'source', ...key, default: stringDefault('cloud_workload') },
          { name: 'created_at', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        indices: [
          new TableIndex({ name: 'uq_tenant_routing_aliases_hostname', columnNames: ['hostname'], isUnique: true }),
          new TableIndex({ name: 'idx_tenant_routing_aliases_lookup', columnNames: ['hostname', 'status'] }),
          new TableIndex({ name: 'idx_tenant_routing_aliases_tenant', columnNames: ['tenant_id', 'status'] }),
        ],
      }), true);
    }

    const operations = pathFor(queryRunner, 'TenantLifecycleOperation', 'tenant_lifecycle_operations');
    if (!await queryRunner.hasTable(operations)) {
      await queryRunner.createTable(new Table({
        name: operations,
        columns: [
          { name: 'id', ...key, isPrimary: true },
          { name: 'actor_id', ...key },
          { name: 'command', ...key },
          { name: 'idempotency_key_hash', ...key },
          { name: 'request_hash', ...key },
          { name: 'tenant_id', ...key, isNullable: true },
          { name: 'status', ...key },
          { name: 'receipt_json', ...document },
          { name: 'created_at', ...timestamp },
          { name: 'updated_at', ...timestamp },
        ],
        indices: [
          new TableIndex({
            name: 'uq_tenant_lifecycle_operation_idempotency',
            columnNames: ['actor_id', 'command', 'idempotency_key_hash'],
            isUnique: true,
          }),
          new TableIndex({ name: 'idx_tenant_lifecycle_operations_tenant', columnNames: ['tenant_id', 'created_at'] }),
        ],
      }), true);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [entityName, fallback] of [
      ['TenantLifecycleOperation', 'tenant_lifecycle_operations'],
      ['TenantRoutingAlias', 'tenant_routing_aliases'],
    ] as const) {
      const table = pathFor(queryRunner, entityName, fallback);
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
