#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) return null
    offset += length + 2
  }
  return null
}

function imageFiles(path) {
  const absolute = resolve(path)
  if (statSync(absolute).isFile()) return [absolute]
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name)
    if (entry.isDirectory()) return imageFiles(child)
    return /\.(?:png|jpe?g)$/i.test(entry.name) ? [child] : []
  })
}

export function auditScreenshots(paths, { width = 1440, height = 900 } = {}) {
  const images = paths.flatMap(imageFiles).sort()
  const records = images.map((file) => {
    const buffer = readFileSync(file)
    const extension = extname(file).toLowerCase()
    const dimensions = extension === '.png' ? pngDimensions(buffer) : jpegDimensions(buffer)
    return {
      file,
      bytes: buffer.length,
      hash: createHash('sha256').update(buffer).digest('hex'),
      width: dimensions?.width || null,
      height: dimensions?.height || null,
      issues: dimensions ? [] : ['unreadable-dimensions'],
    }
  })
  const hashes = Map.groupBy(records, (record) => record.hash)
  for (const record of records) {
    if (record.width !== width || record.height !== height) record.issues.push(`expected-${width}x${height}`)
    if ((hashes.get(record.hash) || []).length > 1) record.issues.push('duplicate-content')
  }
  return records
}

function parseArgs(argv) {
  const options = { paths: [], width: 1440, height: 900, json: false, allowDuplicates: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') options.json = true
    else if (value === '--allow-duplicates') options.allowDuplicates = true
    else if (value === '--width' || value === '--height') {
      options[value.slice(2)] = Number(argv[index + 1]); index += 1
    } else if (value.startsWith('--')) throw new Error(`Unknown option: ${value}`)
    else options.paths.push(value)
  }
  if (options.paths.length === 0) throw new Error('Provide at least one screenshot file or directory.')
  if (!Number.isInteger(options.width) || !Number.isInteger(options.height)) throw new Error('Width and height must be integers.')
  return options
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const records = auditScreenshots(options.paths, options)
  if (options.allowDuplicates) {
    for (const record of records) record.issues = record.issues.filter((issue) => issue !== 'duplicate-content')
  }
  if (options.json) process.stdout.write(`${JSON.stringify(records, null, 2)}\n`)
  else {
    console.log('| Screenshot | Dimensions | Bytes | Issues |')
    console.log('|---|---:|---:|---|')
    for (const record of records) {
      console.log(`| ${record.file} | ${record.width || '?'}x${record.height || '?'} | ${record.bytes} | ${record.issues.join(', ') || 'none'} |`)
    }
  }
  if (records.length === 0 || records.some((record) => record.issues.length > 0)) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try { main() } catch (error) { console.error(`[ui-evidence] ${error.message}`); process.exitCode = 1 }
}
