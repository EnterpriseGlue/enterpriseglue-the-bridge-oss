import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RELEASE_EFFECT_INVENTORY_VERSION,
  RELEASE_EFFECT_SOURCES_V1,
} from '../packages/shared/src/contracts/release-effect-inventory.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifestRelativePath = 'packages/shared/src/schema-epoch-manifest.json'
const chartManifestRelativePath = 'infra/kubernetes/helm/enterpriseglue-host/files/schema-epoch-manifest.json'

export const executableImplementationFiles = Object.freeze([
  'packages/shared/src/db/run-migrations.ts',
  'packages/shared/src/db/schema-epoch.ts',
  'packages/shared/src/db/postgres-tenant-policy.ts',
  'packages/shared/src/db/postgres-migration-context.ts',
  'packages/shared/src/db/migrations/1700000000131-add-release-effect-cohorts.ts',
  'packages/shared/src/db/migrations/1700000000132-enforce-explicit-postgres-context.ts',
  'packages/shared/src/db/migrations/1700000000133-add-cloud-email-passkeys.ts',
  'packages/shared/src/db/migrations/plugin-migration-schema.ts',
  'packages/shared/src/db/release-effect-cohort-schema.ts',
  'packages/shared/src/infrastructure/persistence/pluginColumnPolicy.ts',
  'packages/shared/src/infrastructure/persistence/entities/PluginPlatform.ts',
  'packages/shared/src/db/postgres-tenant-rls.ts',
  'packages/shared/src/db/tenant-ownership-inventory.ts',
  'packages/shared/src/db/schema-epoch-runtime-grant.ts',
  'packages/shared/src/db/schema-epoch-cloud-passkey-grant.ts',
  'packages/shared/src/db/postgres-runtime-grants.ts',
  'packages/shared/src/infrastructure/persistence/entities/CloudEmailSignup.ts',
  'packages/shared/src/infrastructure/persistence/entities/CloudPasskey.ts',
  'packages/shared/src/infrastructure/persistence/entities/CloudPasskeyChallenge.ts',
  'packages/shared/src/contracts/release-effect-inventory.ts',
  'packages/shared/src/services/platform-admin/ReleaseEffectSettlementService.ts',
  'packages/shared/src/services/platform-admin/open-release-effect-cohort.ts',
])

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export function implementationInventoryFromSources(sources) {
  const entries = Object.entries(sources)
    .map(([sourcePath, bytes]) => ({ path: sourcePath, sha256: sha256(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    algorithm: 'sha256-source-v1',
    purpose: 'owner-transition-1700000000131-to-1700000000133-cloud-passkeys/v1',
    count: entries.length,
    sha256: sha256(JSON.stringify(entries)),
  }
}

export function releaseEffectInventoryFromSources(sources = RELEASE_EFFECT_SOURCES_V1) {
  return {
    version: RELEASE_EFFECT_INVENTORY_VERSION,
    sha256: sha256(JSON.stringify({ version: RELEASE_EFFECT_INVENTORY_VERSION, sources })),
  }
}

export async function readExecutableImplementationInventory(base = root) {
  const sources = Object.fromEntries(await Promise.all(executableImplementationFiles.map(async (sourcePath) => [
    sourcePath,
    await readFile(path.join(base, sourcePath)),
  ])))
  return implementationInventoryFromSources(sources)
}

export async function verifySchemaEpochManifest(base = root) {
  const manifestPath = path.join(base, manifestRelativePath)
  const chartManifestPath = path.join(base, chartManifestRelativePath)
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes)
  const actual = await readExecutableImplementationInventory(base)
  assert.deepEqual(
    manifest.executableImplementationInventory,
    actual,
    'schema-epoch executable implementation bytes differ from the signed manifest',
  )
  assert.deepEqual(
    manifest.releaseEffectInventory,
    releaseEffectInventoryFromSources(),
    'schema-epoch release-effect inventory differs from the canonical runtime inventory',
  )
  assert.deepEqual(
    await readFile(chartManifestPath),
    manifestBytes,
    'host chart schema-epoch manifest differs from the canonical shared-package manifest',
  )
  return actual
}

export async function writeSchemaEpochManifest(base = root) {
  const manifestPath = path.join(base, manifestRelativePath)
  const chartManifestPath = path.join(base, chartManifestRelativePath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const executableImplementationInventory = await readExecutableImplementationInventory(base)
  manifest.executableImplementationInventory = executableImplementationInventory
  manifest.releaseEffectInventory = releaseEffectInventoryFromSources()
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`
  await Promise.all([
    writeFile(manifestPath, bytes),
    writeFile(chartManifestPath, bytes),
  ])
  await verifySchemaEpochManifest(base)
  return executableImplementationInventory
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || '--check'
  if (!['verify', '--check', '--write'].includes(mode)) {
    throw new Error('Usage: node scripts/schema-epoch-manifest.mjs [verify|--check|--write]')
  }
  const inventory = mode === '--write'
    ? await writeSchemaEpochManifest()
    : await verifySchemaEpochManifest()
  const action = mode === '--write' ? 'updated' : 'verified'
  console.log(`[schema-epoch-manifest] ${action} ${inventory.count} source files (${inventory.sha256})`)
}
