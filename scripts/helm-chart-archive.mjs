#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const BLOCK_SIZE = 512
const ZERO_BLOCK = Buffer.alloc(BLOCK_SIZE)
const IGNORED_PAX_ATTRIBUTES = new Set([
  'atime',
  'ctime',
  'gid',
  'gname',
  'mtime',
  'uid',
  'uname',
])

function fail(message) {
  throw new Error(message)
}

function trimNulls(value) {
  const end = value.indexOf(0)
  return value.subarray(0, end === -1 ? value.length : end).toString('utf8')
}

function parseTarNumber(value, field, archivePath) {
  if ((value[0] & 0x80) !== 0) {
    const copy = Buffer.from(value)
    const negative = (copy[0] & 0x40) !== 0
    copy[0] &= 0x7f
    let result = 0n
    for (const byte of copy) result = (result << 8n) | BigInt(byte)
    if (negative) result -= 1n << BigInt(copy.length * 8 - 1)
    if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(`${archivePath}: unsupported ${field} value`)
    }
    return Number(result)
  }

  const raw = trimNulls(value).trim()
  if (raw === '') return 0
  if (!/^[0-7]+$/.test(raw)) fail(`${archivePath}: invalid ${field} value`)
  const parsed = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(parsed)) fail(`${archivePath}: unsupported ${field} value`)
  return parsed
}

function verifyHeaderChecksum(header, archivePath, offset) {
  const expected = parseTarNumber(header.subarray(148, 156), 'header checksum', archivePath)
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) {
    fail(`${archivePath}: invalid tar header checksum at byte ${offset}`)
  }
}

function validatePath(rawPath, type, archivePath) {
  let value = rawPath
  if (type === 'directory') value = value.replace(/\/+$/, '')
  if (!value || value.startsWith('/') || value.includes('\\')) {
    fail(`${archivePath}: unsafe archive path ${JSON.stringify(rawPath)}`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${archivePath}: unsafe archive path ${JSON.stringify(rawPath)}`)
  }
  return value
}

function validateLinkTarget(rawTarget, entryPath, archivePath) {
  if (!rawTarget || rawTarget.startsWith('/') || rawTarget.includes('\\')) {
    fail(`${archivePath}: unsafe link target ${JSON.stringify(rawTarget)} for ${entryPath}`)
  }
  const resolved = [...entryPath.split('/').slice(0, -1)]
  for (const segment of rawTarget.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (resolved.length === 0) {
        fail(`${archivePath}: link target escapes the archive for ${entryPath}`)
      }
      resolved.pop()
    } else {
      resolved.push(segment)
    }
  }
  return rawTarget
}

function parsePax(payload, archivePath) {
  const attributes = {}
  let offset = 0
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset)
    if (space === -1) fail(`${archivePath}: malformed PAX record length`)
    const lengthText = payload.subarray(offset, space).toString('ascii')
    if (!/^[1-9][0-9]*$/.test(lengthText)) fail(`${archivePath}: malformed PAX record length`)
    const length = Number.parseInt(lengthText, 10)
    const end = offset + length
    if (!Number.isSafeInteger(length) || end > payload.length || payload[end - 1] !== 0x0a) {
      fail(`${archivePath}: malformed PAX record`)
    }
    const record = payload.subarray(space + 1, end - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals <= 0) fail(`${archivePath}: malformed PAX attribute`)
    attributes[record.slice(0, equals)] = record.slice(equals + 1)
    offset = end
  }
  return attributes
}

function relevantPaxAttributes(globalPax, localPax) {
  const combined = { ...globalPax, ...localPax }
  for (const key of ['path', 'linkpath', 'size', ...IGNORED_PAX_ATTRIBUTES]) delete combined[key]
  return Object.fromEntries(Object.entries(combined).sort(([left], [right]) => left.localeCompare(right)))
}

function entryType(typeFlag) {
  if (typeFlag === '' || typeFlag === '0') return 'file'
  if (typeFlag === '1') return 'hardlink'
  if (typeFlag === '2') return 'symlink'
  if (typeFlag === '5') return 'directory'
  return null
}

function parseSizeOverride(rawSize, archivePath) {
  if (rawSize === undefined) return null
  if (!/^(?:0|[1-9][0-9]*)$/.test(rawSize)) fail(`${archivePath}: invalid PAX size value`)
  const result = Number.parseInt(rawSize, 10)
  if (!Number.isSafeInteger(result)) fail(`${archivePath}: unsupported PAX size value`)
  return result
}

export function canonicalizeHelmChartArchiveBytes(compressed, archivePath = '<archive>') {
  let tar
  try {
    tar = gunzipSync(compressed)
  } catch (error) {
    fail(`${archivePath}: invalid gzip stream: ${error.message}`)
  }

  const entries = []
  const seenPaths = new Set()
  let offset = 0
  let globalPax = {}
  let localPax = {}
  let longName = null
  let longLink = null
  let foundEnd = false

  while (offset + BLOCK_SIZE <= tar.length) {
    const headerOffset = offset
    const header = tar.subarray(offset, offset + BLOCK_SIZE)
    offset += BLOCK_SIZE
    if (header.equals(ZERO_BLOCK)) {
      foundEnd = true
      break
    }

    verifyHeaderChecksum(header, archivePath, headerOffset)
    const headerSize = parseTarNumber(header.subarray(124, 136), 'entry size', archivePath)
    const paddedSize = Math.ceil(headerSize / BLOCK_SIZE) * BLOCK_SIZE
    if (offset + paddedSize > tar.length) fail(`${archivePath}: truncated tar entry at byte ${headerOffset}`)
    const payload = tar.subarray(offset, offset + headerSize)
    offset += paddedSize

    const typeFlag = trimNulls(header.subarray(156, 157))
    if (typeFlag === 'g' || typeFlag === 'x') {
      const parsed = parsePax(payload, archivePath)
      if (typeFlag === 'g') globalPax = { ...globalPax, ...parsed }
      else localPax = parsed
      continue
    }
    if (typeFlag === 'L' || typeFlag === 'K') {
      const value = trimNulls(payload).replace(/\n$/, '')
      if (typeFlag === 'L') longName = value
      else longLink = value
      continue
    }

    const type = entryType(typeFlag)
    if (!type) fail(`${archivePath}: unsupported tar entry type ${JSON.stringify(typeFlag)}`)
    const prefix = trimNulls(header.subarray(345, 500))
    const shortName = trimNulls(header.subarray(0, 100))
    const headerPath = prefix ? `${prefix}/${shortName}` : shortName
    const rawPath = localPax.path ?? longName ?? globalPax.path ?? headerPath
    const path = validatePath(rawPath, type, archivePath)
    if (seenPaths.has(path)) fail(`${archivePath}: duplicate archive path ${path}`)
    seenPaths.add(path)

    const sizeOverride = parseSizeOverride(localPax.size ?? globalPax.size, archivePath)
    const effectiveSize = sizeOverride ?? headerSize
    if (effectiveSize !== headerSize) {
      fail(`${archivePath}: PAX size does not match the tar payload for ${path}`)
    }
    if (type !== 'file' && headerSize !== 0) {
      fail(`${archivePath}: non-file entry ${path} has an unexpected payload`)
    }

    const headerLink = trimNulls(header.subarray(157, 257))
    const rawLink = localPax.linkpath ?? longLink ?? globalPax.linkpath ?? headerLink
    const descriptor = {
      path,
      type,
      mode: parseTarNumber(header.subarray(100, 108), 'entry mode', archivePath) & 0o7777,
      pax: relevantPaxAttributes(globalPax, localPax),
    }
    if (type === 'file') {
      descriptor.size = headerSize
      descriptor.sha256 = createHash('sha256').update(payload).digest('hex')
    } else if (type === 'symlink' || type === 'hardlink') {
      descriptor.linkTarget = validateLinkTarget(rawLink, path, archivePath)
    }
    entries.push(descriptor)
    localPax = {}
    longName = null
    longLink = null
  }

  if (!foundEnd) fail(`${archivePath}: tar archive has no end marker`)
  if (tar.subarray(offset).some((byte) => byte !== 0)) fail(`${archivePath}: non-zero data follows the tar end marker`)
  if (localPax || longName || longLink) {
    if (Object.keys(localPax).length > 0 || longName !== null || longLink !== null) {
      fail(`${archivePath}: orphaned extended tar header`)
    }
  }

  entries.sort((left, right) => left.path.localeCompare(right.path))
  const canonical = Buffer.from(`${JSON.stringify(entries)}\n`, 'utf8')
  return {
    digest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
    entries,
  }
}

export async function canonicalizeHelmChartArchive(archivePath) {
  return canonicalizeHelmChartArchiveBytes(await readFile(archivePath), archivePath)
}

function describeEntry(entry) {
  return JSON.stringify(entry)
}

export function compareCanonicalHelmCharts(candidate, published) {
  const candidateByPath = new Map(candidate.entries.map((entry) => [entry.path, entry]))
  const publishedByPath = new Map(published.entries.map((entry) => [entry.path, entry]))
  const paths = [...new Set([...candidateByPath.keys(), ...publishedByPath.keys()])].sort()
  const differences = []
  for (const path of paths) {
    const left = candidateByPath.get(path)
    const right = publishedByPath.get(path)
    if (!left) differences.push(`added in published archive: ${path}`)
    else if (!right) differences.push(`missing from published archive: ${path}`)
    else if (describeEntry(left) !== describeEntry(right)) differences.push(`payload differs: ${path}`)
  }
  return { equivalent: differences.length === 0, differences }
}

async function main(args = process.argv.slice(2)) {
  const [command, candidatePath, publishedPath, ...rest] = args
  if (command !== 'compare' || !candidatePath || !publishedPath || rest.length > 0) {
    fail('usage: node scripts/helm-chart-archive.mjs compare <candidate.tgz> <published.tgz>')
  }
  const [candidate, published] = await Promise.all([
    canonicalizeHelmChartArchive(candidatePath),
    canonicalizeHelmChartArchive(publishedPath),
  ])
  const comparison = compareCanonicalHelmCharts(candidate, published)
  if (!comparison.equivalent) {
    console.error(`Helm chart payloads differ:\n${comparison.differences.map((line) => `- ${line}`).join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({
    status: 'equivalent',
    candidate: candidatePath,
    published: publishedPath,
    canonicalDigest: candidate.digest,
    entries: candidate.entries.length,
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[helm-chart-archive] ${error.message}`)
    process.exitCode = 1
  })
}

