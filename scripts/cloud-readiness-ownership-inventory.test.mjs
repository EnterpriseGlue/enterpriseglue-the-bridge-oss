import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  assertTenantPersistenceOwnershipV1,
  TENANT_EXECUTION_OWNERSHIP_V1,
  TENANT_PERSISTENCE_OWNERSHIP_V1,
} from '../packages/shared/src/db/tenant-ownership-inventory.ts'
import {
  buildOwnershipInventory,
  validateOwnershipInventory,
} from './cloud-readiness-ownership-inventory.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the repository has complete persistence and timed plugin execution classifications', async () => {
  const inventory = await buildOwnershipInventory(root)
  assert.equal(inventory.schemaVersion, 1)
  assert.equal(inventory.persistence.length, TENANT_PERSISTENCE_OWNERSHIP_V1.length)
  assert.equal(inventory.execution.length, TENANT_EXECUTION_OWNERSHIP_V1.length)
  assert.ok(inventory.summary.persistenceScopes.tenant_direct > 0)
  assert.ok(inventory.summary.enforcementModes.postgres_forced_rls > 0)
})

test('an unclassified TypeORM entity is rejected', () => {
  assert.throws(() => validateOwnershipInventory({
    entities: [{
      table: 'new_tenant_rows',
      entity: 'NewTenantRow',
      source: 'packages/shared/src/infrastructure/persistence/entities/NewTenantRow.ts',
      columns: ['id', 'tenant_id'],
    }],
    timedExecutions: [],
    persistence: [],
    executions: [],
  }), /unclassified TypeORM entity: new_tenant_rows/)
})

test('a declared tenant key that drifts from the entity is rejected', () => {
  assert.throws(() => validateOwnershipInventory({
    entities: [{
      table: 'tenant_rows',
      entity: 'TenantRow',
      source: 'TenantRow.ts',
      columns: ['id'],
    }],
    timedExecutions: [],
    persistence: [{
      table: 'tenant_rows',
      scope: 'tenant_direct',
      enforcement: 'postgres_forced_rls',
      keyColumns: ['tenant_id'],
      parentTables: [],
      rationale: 'fixture',
    }],
    executions: [],
  }), /declared tenant key is missing: tenant_rows\.tenant_id/)
})

test('a new timed plugin execution requires a classification', () => {
  assert.throws(() => validateOwnershipInventory({
    entities: [],
    timedExecutions: [{
      source: 'packages/backend-host/src/plugins/newTenantPoller.ts',
      contents: 'setInterval(() => undefined, 1000)',
    }],
    persistence: [],
    executions: [],
  }), /unclassified timed plugin execution: .*newTenantPoller\.ts/)
})

test('pooled runtime metadata rejects unknown entities and declared-key drift', () => {
  assert.doesNotThrow(() => assertTenantPersistenceOwnershipV1([{
    tableName: 'projects',
    columns: [{ databaseName: 'tenant_id' }],
  }]))
  assert.throws(() => assertTenantPersistenceOwnershipV1([{
    tableName: 'unknown_rows',
    columns: [{ databaseName: 'tenant_id' }],
  }]), /unclassified: unknown_rows/)
  assert.throws(() => assertTenantPersistenceOwnershipV1([{
    tableName: 'projects',
    columns: [{ databaseName: 'id' }],
  }]), /missing declared keys: projects\(tenant_id\)/)
})
