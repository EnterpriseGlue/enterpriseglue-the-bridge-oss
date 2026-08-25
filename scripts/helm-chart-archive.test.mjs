import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import test from 'node:test'

import {
  canonicalizeHelmChartArchiveBytes,
  compareCanonicalHelmCharts,
} from './helm-chart-archive.mjs'

const BLOCK_SIZE = 512

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0')
  header.write(encoded, offset, length - 1, 'ascii')
  header[offset + length - 1] = 0
}

function tarArchive(entries, { mtime = 1 } = {}) {
  const chunks = []
  for (const entry of entries) {
    const body = Buffer.from(entry.content ?? '', 'utf8')
    const header = Buffer.alloc(BLOCK_SIZE)
    header.write(entry.path, 0, 100, 'utf8')
    writeOctal(header, 100, 8, entry.mode ?? 0o644)
    writeOctal(header, 108, 8, entry.uid ?? 1000)
    writeOctal(header, 116, 8, entry.gid ?? 1000)
    writeOctal(header, 124, 12, body.length)
    writeOctal(header, 136, 12, mtime)
    header.fill(0x20, 148, 156)
    header[156] = (entry.type ?? '0').charCodeAt(0)
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    header.write('builder', 265, 32, 'utf8')
    header.write('builder', 297, 32, 'utf8')
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii')
    header[154] = 0
    header[155] = 0x20
    chunks.push(header, body)
    const padding = (BLOCK_SIZE - (body.length % BLOCK_SIZE)) % BLOCK_SIZE
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2))
  return gzipSync(Buffer.concat(chunks), { mtime })
}

const baseEntries = [
  { path: 'example/Chart.yaml', content: 'apiVersion: v2\nname: example\nversion: 1.0.0\n' },
  { path: 'example/templates/deployment.yaml', content: 'kind: Deployment\n', mode: 0o644 },
]

test('equates chart archives whose payload is identical but metadata timestamps differ', () => {
  const firstBytes = tarArchive(baseEntries, { mtime: 10 })
  const secondBytes = tarArchive(baseEntries, { mtime: 20 })
  assert.notEqual(createHash('sha256').update(firstBytes).digest('hex'), createHash('sha256').update(secondBytes).digest('hex'))
  const first = canonicalizeHelmChartArchiveBytes(firstBytes, 'first.tgz')
  const second = canonicalizeHelmChartArchiveBytes(secondBytes, 'second.tgz')
  assert.equal(first.digest, second.digest)
  assert.deepEqual(compareCanonicalHelmCharts(first, second), { equivalent: true, differences: [] })
})

test('rejects a file content change', () => {
  const first = canonicalizeHelmChartArchiveBytes(tarArchive(baseEntries), 'first.tgz')
  const changed = baseEntries.map((entry) => entry.path.endsWith('deployment.yaml') ? { ...entry, content: 'kind: StatefulSet\n' } : entry)
  const second = canonicalizeHelmChartArchiveBytes(tarArchive(changed), 'second.tgz')
  assert.deepEqual(compareCanonicalHelmCharts(first, second), {
    equivalent: false,
    differences: ['payload differs: example/templates/deployment.yaml'],
  })
})

test('rejects an executable-mode change', () => {
  const first = canonicalizeHelmChartArchiveBytes(tarArchive(baseEntries), 'first.tgz')
  const changed = baseEntries.map((entry) => entry.path.endsWith('deployment.yaml') ? { ...entry, mode: 0o755 } : entry)
  const second = canonicalizeHelmChartArchiveBytes(tarArchive(changed), 'second.tgz')
  assert.equal(compareCanonicalHelmCharts(first, second).equivalent, false)
})

test('rejects an added archive path', () => {
  const first = canonicalizeHelmChartArchiveBytes(tarArchive(baseEntries), 'first.tgz')
  const second = canonicalizeHelmChartArchiveBytes(tarArchive([...baseEntries, { path: 'example/values.yaml', content: '{}\n' }]), 'second.tgz')
  assert.deepEqual(compareCanonicalHelmCharts(first, second).differences, ['added in published archive: example/values.yaml'])
})

test('rejects archive paths that could escape extraction', () => {
  const archive = tarArchive([{ path: '../escape', content: 'unsafe' }])
  assert.throws(() => canonicalizeHelmChartArchiveBytes(archive, 'unsafe.tgz'), /unsafe archive path/)
})

test('rejects malformed tar headers instead of comparing untrusted payloads', () => {
  const archive = Buffer.from(tarArchive(baseEntries))
  const tar = Buffer.from(gunzipSync(archive))
  tar[0] ^= 0x01
  assert.throws(
    () => canonicalizeHelmChartArchiveBytes(gzipSync(tar), 'corrupt.tgz'),
    /invalid tar header checksum/,
  )
})
