import assert from 'node:assert/strict'
import test from 'node:test'

import {
  implementationInventoryFromSources,
  releaseEffectInventoryFromSources,
  verifySchemaEpochManifest,
} from './schema-epoch-manifest.mjs'

test('signed schema-epoch implementation inventory matches its executable sources', async () => {
  await assert.doesNotReject(() => verifySchemaEpochManifest())
})

test('release-effect inventory mutations change the receipt-bound digest', () => {
  const source = {
    sourceId: 'example', owner: 'api', settlementRequired: true,
    coverage: 'authoritative', durableTables: ['example'],
    admissionBoundary: 'transaction', settlementBasis: 'terminal row',
  }
  const baseline = releaseEffectInventoryFromSources([source])
  const mutation = releaseEffectInventoryFromSources([{ ...source, durableTables: ['changed'] }])
  assert.notEqual(mutation.sha256, baseline.sha256)
})

test('migration, pinned policy, and cohort-opener mutations change the implementation digest', () => {
  const baseline = implementationInventoryFromSources({
    'migration.ts': Buffer.from('export const migration = 1'),
    'policy.ts': Buffer.from('export const policy = 1'),
    'cohort.ts': Buffer.from('export const cohort = 1'),
  })
  const migrationMutation = implementationInventoryFromSources({
    'migration.ts': Buffer.from('export const migration = 2'),
    'policy.ts': Buffer.from('export const policy = 1'),
    'cohort.ts': Buffer.from('export const cohort = 1'),
  })
  const policyMutation = implementationInventoryFromSources({
    'migration.ts': Buffer.from('export const migration = 1'),
    'policy.ts': Buffer.from('export const policy = 2'),
    'cohort.ts': Buffer.from('export const cohort = 1'),
  })
  const cohortMutation = implementationInventoryFromSources({
    'migration.ts': Buffer.from('export const migration = 1'),
    'policy.ts': Buffer.from('export const policy = 1'),
    'cohort.ts': Buffer.from('export const cohort = 2'),
  })
  assert.notEqual(migrationMutation.sha256, baseline.sha256)
  assert.notEqual(policyMutation.sha256, baseline.sha256)
  assert.notEqual(cohortMutation.sha256, baseline.sha256)
})
