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
  await mkdir(path.join(artifacts, 'packages'), { recursive: true })
  const files = [
    'charts/enterpriseglue-host-0.1.2.tgz',
    'charts/enterpriseglue-plugin-installer-rbac-0.2.6.tgz',
    'charts/enterpriseglue-plugin-manager-0.1.6.tgz',
    'charts/enterpriseglue-plugin-runtime-0.2.6.tgz',
    'packages/enterpriseglue-plugin-installer-0.2.6.tgz',
    'packages/enterpriseglue-plugin-manager-0.1.6.tgz',
    'packages/enterpriseglue-plugin-runtime-0.2.3.tgz',
    'packages/enterpriseglue-plugin-sdk-0.5.1.tgz',
  ]
  await Promise.all(files.map((file) => writeFile(path.join(artifacts, file), `payload:${file}`)))
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
  assert.equal(created.artifacts.length, 8)
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
  await writeFile(path.join(artifacts, 'packages/enterpriseglue-plugin-sdk-0.5.1.tgz'), 'changed')
  await assert.rejects(
    verifyReceipt({ receipt: output, artifacts }),
    /checksums or inventory/,
  )
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
