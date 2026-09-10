#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseManagedShardBootstrapManifest } from './managed-shard-bootstrap-contract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'infra/database/managed-shard-bootstrap-manifest.json')
const chartManifestPath = path.join(root, 'infra/kubernetes/helm/enterpriseglue-host/files/managed-shard-bootstrap-manifest.json')

async function implementationDigest(files) {
  const entries = []
  for (const file of files) {
    const bytes = await readFile(path.join(root, file))
    entries.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

async function main() {
  const mode = process.argv[2] || '--check'
  if (!['--check', '--write'].includes(mode)) throw new Error('usage: managed-shard-bootstrap-manifest.mjs [--check|--write]')
  const manifest = parseManagedShardBootstrapManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const actual = await implementationDigest(manifest.implementationInventory.files)
  if (mode === '--write') {
    manifest.implementationInventory.sha256 = actual
    const bytes = `${JSON.stringify(manifest, null, 2)}\n`
    await Promise.all([writeFile(manifestPath, bytes), writeFile(chartManifestPath, bytes)])
    process.stdout.write(`${actual}\n`)
    return
  }
  if (manifest.implementationInventory.sha256 !== actual) throw new Error(`Managed-shard bootstrap implementation digest mismatch: expected ${manifest.implementationInventory.sha256}, got ${actual}`)
  const chartManifest = await readFile(chartManifestPath)
  const sourceManifest = await readFile(manifestPath)
  if (!chartManifest.equals(sourceManifest)) throw new Error('Host chart managed-shard bootstrap manifest differs from the canonical source')
  process.stdout.write(`${actual}\n`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
