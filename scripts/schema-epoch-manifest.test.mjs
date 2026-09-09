import assert from 'node:assert/strict'
import test from 'node:test'

import {
  implementationInventoryFromSources,
  verifySchemaEpochManifest,
} from './schema-epoch-manifest.mjs'

test('signed schema-epoch implementation inventory matches its executable sources', async () => {
  await assert.doesNotReject(() => verifySchemaEpochManifest())
})

test('migration and pinned policy mutations change the implementation digest', () => {
  const baseline = implementationInventoryFromSources({
    'migration.ts': Buffer.from('export const migration = 1'),
    'policy.ts': Buffer.from('export const policy = 1'),
  })
  const migrationMutation = implementationInventoryFromSources({
    'migration.ts': Buffer.from('export const migration = 2'),
    'policy.ts': Buffer.from('export const policy = 1'),
  })
  const policyMutation = implementationInventoryFromSources({
    'migration.ts': Buffer.from('export const migration = 1'),
    'policy.ts': Buffer.from('export const policy = 2'),
  })
  assert.notEqual(migrationMutation.sha256, baseline.sha256)
  assert.notEqual(policyMutation.sha256, baseline.sha256)
})
