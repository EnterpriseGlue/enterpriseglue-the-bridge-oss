import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createReceipt, verifyReceipt } from './release-candidate-receipt.mjs'

const sourceRevision = '1'.repeat(40)
const releaseTag = 'v0.20.0'
const digest = `sha256:${'a'.repeat(64)}`
const subjectArgs = {
  backend: `ghcr.io/enterpriseglue/backend@${digest}`,
  frontend: `ghcr.io/enterpriseglue/frontend@${digest}`,
  managedShardBootstrap: `ghcr.io/enterpriseglue/managed-shard-bootstrap@${digest}`,
  pluginInstaller: `ghcr.io/enterpriseglue/plugin-installer@${digest}`,
  pluginManager: `ghcr.io/enterpriseglue/plugin-manager@${digest}`,
  hostChart: `ghcr.io/enterpriseglue/host-chart@${digest}`,
  runtimeChart: `ghcr.io/enterpriseglue/runtime-chart@${digest}`,
  installerRbacChart: `ghcr.io/enterpriseglue/rbac-chart@${digest}`,
  managerChart: `ghcr.io/enterpriseglue/manager-chart@${digest}`,
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eg-release-candidate-'))
  const artifacts = path.join(root, 'artifacts')
  await mkdir(path.join(artifacts, 'charts'), { recursive: true })
  await mkdir(path.join(artifacts, 'packages', 'plugin'), { recursive: true })
  await mkdir(path.join(artifacts, 'packages', 'host'), { recursive: true })
  await mkdir(path.join(artifacts, 'metadata'), { recursive: true })
  const files = [
    'charts/enterpriseglue-host-0.1.2.tgz',
    'charts/enterpriseglue-plugin-installer-rbac-0.2.6.tgz',
    'charts/enterpriseglue-plugin-manager-0.1.6.tgz',
    'charts/enterpriseglue-plugin-runtime-0.2.6.tgz',
    'packages/plugin/enterpriseglue-enterprise-plugin-api-0.4.0.tgz',
    'packages/plugin/enterpriseglue-plugin-installer-0.2.6.tgz',
    'packages/plugin/enterpriseglue-plugin-manager-0.1.6.tgz',
    'packages/plugin/enterpriseglue-plugin-runtime-0.2.3.tgz',
    'packages/plugin/enterpriseglue-plugin-sdk-0.5.1.tgz',
    'packages/host/enterpriseglue-shared-0.15.3.tgz',
    'packages/host/enterpriseglue-backend-host-0.13.4.tgz',
    'packages/host/enterpriseglue-frontend-host-0.15.4.tgz',
  ]
  await Promise.all(files.map((file) => writeFile(path.join(artifacts, file), `payload:${file}`)))
  await writeFile(
    path.join(artifacts, 'metadata/schema-epoch-manifest.json'),
    await readFile(new URL('../packages/shared/src/schema-epoch-manifest.json', import.meta.url)),
  )
  await writeFile(
    path.join(artifacts, 'metadata/managed-shard-bootstrap-manifest.json'),
    await readFile(new URL('../infra/database/managed-shard-bootstrap-manifest.json', import.meta.url)),
  )
  return { root, artifacts, output: path.join(root, 'release-candidate.json') }
}

test('creates and verifies an exact immutable candidate receipt', async () => {
  const { artifacts, output } = await fixture()
  const args = {
    'source-ref': sourceRevision,
    'release-tag': releaseTag,
    artifacts,
    output,
    ...subjectArgs,
  }
  const created = await createReceipt(args)
  assert.equal(created.schemaVersion, 'enterpriseglue-release-candidate/v1')
  assert.equal(created.publicationPerformed, false)
  assert.equal(created.artifacts.length, 14)
  assert.equal(created.schemaEpoch.applicationStartupMode, 'verify-only')
  assert.equal(created.schemaEpoch.preflightMode, 'verify-runtime-grant')
  assert.equal(created.schemaEpoch.ownerMigrationMode, 'apply-through-executable')
  assert.deepEqual(created.schemaEpoch.ownerMigrationFrom, {
    through: 1700000000130,
    count: 132,
    sha256: 'e525e9f9fe8d66498aeea6beb03d6257274de3a38a7b48819de6edccf02ecb16',
    postgresPolicyProfile: 'legacy-tenant-context/v1',
  })
  assert.equal(created.schemaEpoch.ownerRuntimeGrant, 'configured-role-release-effect-cohorts-select-insert-update/v1')
  assert.equal(created.schemaEpoch.freshDatabase, 'requires-separate-signed-bootstrap')
  assert.equal(created.schemaEpoch.emptyMigrationLedger, 'requires-separate-signed-recovery')
  assert.match(created.schemaEpoch.executableImplementationSha256, /^[0-9a-f]{64}$/)
  assert.equal(created.schemaEpoch.executableImplementationPurpose, 'owner-transition-1700000000131-dual-context-closure/v1')
  assert.equal(created.schemaEpoch.releaseEffectInventoryVersion, 'release-effect-inventory.enterpriseglue.io/v1')
  assert.equal(created.schemaEpoch.releaseEffectInventorySha256, 'c35183c2dee4ec8477948fdcd00d8b0b5e10de051d6e5ce9001950e2dac36087')
  assert.deepEqual(created.schemaEpoch.acceptedDatabaseEpochs.map(({ id, through, postgresPolicyProfile }) => ({
    id, through, postgresPolicyProfile,
  })), [
    { id: 'pre-enforcement', through: 1700000000131, postgresPolicyProfile: 'dual-context-compatibility/v1' },
    { id: 'post-enforcement', through: 1700000000132, postgresPolicyProfile: 'explicit-context/v1' },
  ])
  assert.equal(created.managedShardBootstrap.enabledByDefault, false)
  assert.equal(created.managedShardBootstrap.id, 'postgres-v0.24.2-exact-0130/v1')
  assert.equal(created.managedShardBootstrap.predecessor.migrationInventory.through, created.schemaEpoch.ownerMigrationFrom.through)
  assert.equal(created.managedShardBootstrap.predecessor.migrationInventory.sha256, created.schemaEpoch.ownerMigrationFrom.sha256)
  assert.equal(created.managedShardBootstrap.predecessor.postgresPolicyProfile, created.schemaEpoch.ownerMigrationFrom.postgresPolicyProfile)
  assert.equal(created.managedShardBootstrap.execution.synchronize, 'forbidden')
  assert.deepEqual(await verifyReceipt({
    receipt: output,
    artifacts,
    'source-ref': sourceRevision,
    'release-tag': releaseTag,
  }), created)
})

test('rejects changed candidate bytes', async () => {
  const { artifacts, output } = await fixture()
  await createReceipt({
    'source-ref': sourceRevision,
    'release-tag': releaseTag,
    artifacts,
    output,
    ...subjectArgs,
  })
  await writeFile(path.join(artifacts, 'packages/plugin/enterpriseglue-plugin-sdk-0.5.1.tgz'), 'changed')
  await assert.rejects(
    verifyReceipt({ receipt: output, artifacts }),
    /checksums or inventory/,
  )
})

test('rejects a schema-epoch receipt projection that differs from the inventoried manifest', async () => {
  const { artifacts, output } = await fixture()
  await createReceipt({
    'source-ref': sourceRevision,
    'release-tag': releaseTag,
    artifacts,
    output,
    ...subjectArgs,
  })
  const receipt = JSON.parse(await readFile(output, 'utf8'))
  receipt.schemaEpoch.acceptedDatabaseEpochs[0].postgresPolicyProfile = 'explicit-context/v1'
  await writeFile(output, JSON.stringify(receipt))
  await assert.rejects(verifyReceipt({ receipt: output, artifacts }), /does not match/)
})

test('rejects a managed-shard bootstrap projection that differs from its inventoried manifest', async () => {
  const { artifacts, output } = await fixture()
  await createReceipt({
    'source-ref': sourceRevision,
    'release-tag': releaseTag,
    artifacts,
    output,
    ...subjectArgs,
  })
  const receipt = JSON.parse(await readFile(output, 'utf8'))
  receipt.managedShardBootstrap.execution.synchronize = 'allowed'
  await writeFile(output, JSON.stringify(receipt))
  await assert.rejects(verifyReceipt({ receipt: output, artifacts }), /managed-shard bootstrap receipt does not match/)
})

test('rejects a mutable or off-namespace subject', async () => {
  const { artifacts, output } = await fixture()
  await assert.rejects(createReceipt({
    'source-ref': sourceRevision,
    'release-tag': releaseTag,
    artifacts,
    output,
    ...subjectArgs,
    backend: 'docker.io/enterpriseglue/backend:latest',
  }), /immutable EnterpriseGlue GHCR digest/)
  await assert.rejects(readFile(output, 'utf8'))
})
