import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

export const executableImplementationFiles = Object.freeze([
  'packages/shared/src/db/migrations/1700000000131-add-release-effect-cohorts.ts',
  'packages/shared/src/db/migrations/plugin-migration-schema.ts',
  'packages/shared/src/infrastructure/persistence/pluginColumnPolicy.ts',
  'packages/shared/src/infrastructure/persistence/entities/PluginPlatform.ts',
  'packages/shared/src/db/postgres-tenant-rls.ts',
  'packages/shared/src/db/schema-epoch-runtime-grant.ts',
])

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export function implementationInventoryFromSources(sources) {
  const entries = Object.entries(sources)
    .map(([sourcePath, bytes]) => ({ path: sourcePath, sha256: sha256(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    algorithm: 'sha256-source-v1',
    count: entries.length,
    sha256: sha256(JSON.stringify(entries)),
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
  const manifest = JSON.parse(await readFile(path.join(base, 'packages/shared/src/schema-epoch-manifest.json'), 'utf8'))
  const actual = await readExecutableImplementationInventory(base)
  assert.deepEqual(
    manifest.executableImplementationInventory,
    actual,
    'schema-epoch executable implementation bytes differ from the signed manifest',
  )
  return actual
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'verify') throw new Error('Usage: node scripts/schema-epoch-manifest.mjs verify')
  const inventory = await verifySchemaEpochManifest()
  console.log(`[schema-epoch-manifest] verified ${inventory.count} source files (${inventory.sha256})`)
}
