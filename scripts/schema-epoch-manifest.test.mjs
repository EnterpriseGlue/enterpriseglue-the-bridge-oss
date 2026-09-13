import assert from 'node:assert/strict'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  executableImplementationFiles,
  implementationInventoryFromSources,
  releaseEffectInventoryFromSources,
  verifySchemaEpochManifest,
  writeSchemaEpochManifest,
} from './schema-epoch-manifest.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

test('signed schema-epoch implementation inventory matches its executable sources', async () => {
  await assert.doesNotReject(() => verifySchemaEpochManifest())
})

test('manifest writer is reproducible and synchronizes the shared-package and chart copies', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'enterpriseglue-schema-epoch-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const manifestPaths = [
    'packages/shared/src/schema-epoch-manifest.json',
    'infra/kubernetes/helm/enterpriseglue-host/files/schema-epoch-manifest.json',
  ]
  for (const relativePath of [...executableImplementationFiles, ...manifestPaths]) {
    await mkdir(path.dirname(path.join(base, relativePath)), { recursive: true })
  }
  await Promise.all(executableImplementationFiles.map((relativePath) =>
    copyFile(path.join(root, relativePath), path.join(base, relativePath))))
  await Promise.all(manifestPaths.map((relativePath) =>
    copyFile(path.join(root, 'packages/shared/src/schema-epoch-manifest.json'), path.join(base, relativePath))))

  const firstInventory = await writeSchemaEpochManifest(base)
  const firstBytes = await readFile(path.join(base, manifestPaths[0]))
  assert.deepEqual(await readFile(path.join(base, manifestPaths[1])), firstBytes)
  assert.deepEqual(JSON.parse(firstBytes).executableImplementationInventory, firstInventory)
  assert.equal(JSON.parse(firstBytes).id, 'postgres-explicit-context-bridge-v1')
  await writeSchemaEpochManifest(base)
  assert.deepEqual(await readFile(path.join(base, manifestPaths[0])), firstBytes)

  await appendFile(path.join(base, executableImplementationFiles[0]), '\n// digest mutation\n')
  await assert.rejects(
    () => verifySchemaEpochManifest(base),
    /schema-epoch executable implementation bytes differ from the signed manifest/,
  )
  const changedInventory = await writeSchemaEpochManifest(base)
  assert.notEqual(changedInventory.sha256, firstInventory.sha256)
  await assert.doesNotReject(() => verifySchemaEpochManifest(base))

  await appendFile(path.join(base, manifestPaths[1]), '\n')
  await assert.rejects(
    () => verifySchemaEpochManifest(base),
    /host chart schema-epoch manifest differs from the canonical shared-package manifest/,
  )
  await writeSchemaEpochManifest(base)
  await assert.doesNotReject(() => verifySchemaEpochManifest(base))
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
