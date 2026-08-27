import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TenantLifecycleOperation } from '../../infrastructure/persistence/entities/TenantLifecycleOperation.js';
import { TenantRoutingAlias } from '../../infrastructure/persistence/entities/TenantRoutingAlias.js';
import {
  portableBigint,
  portableStringDefault,
  portableText,
} from './support/portable-columns.js';

const pathFor = (queryRunner: QueryRunner, entity: Function): string => queryRunner.connection.getMetadata(entity).tablePath;

export class AddTenantWorkloadLifecycle1700000000127 implements MigrationInterface {
  name = 'AddTenantWorkloadLifecycle1700000000127';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = portableText(queryRunner, 'key');
    const document = portableText(queryRunner, 'document');
    const timestamp = portableBigint(queryRunner);
    const stringDefault = (value: string) => portableStringDefault(queryRunner, value);

    const aliases = pathFor(queryRunner, TenantRoutingAlias);
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

    const operations = pathFor(queryRunner, TenantLifecycleOperation);
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
    for (const entity of [TenantLifecycleOperation, TenantRoutingAlias]) {
      const table = pathFor(queryRunner, entity);
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
