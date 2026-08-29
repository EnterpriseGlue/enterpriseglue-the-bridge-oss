#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SCHEMA_VERSION = 'enterpriseglue-release-candidate/v1'
const REQUIRED_SUBJECTS = [
  'backend',
  'frontend',
  'pluginInstaller',
  'pluginManager',
  'hostChart',
  'runtimeChart',
  'installerRbacChart',
  'managerChart',
]
const REQUIRED_ARTIFACTS = [
  /^charts\/enterpriseglue-host-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/,
  /^charts\/enterpriseglue-plugin-runtime-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^charts\/enterpriseglue-plugin-installer-rbac-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^charts\/enterpriseglue-plugin-manager-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/enterpriseglue-plugin-sdk-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/enterpriseglue-plugin-runtime-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/enterpriseglue-plugin-installer-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/enterpriseglue-plugin-manager-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
]

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const [command, ...tokens] = argv
  const args = {}
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index]
    const value = tokens[index + 1]
    if (!key?.startsWith('--') || value === undefined) fail(`Invalid argument near ${key || '<end>'}`)
    args[key.slice(2)] = value
  }
  return { command, args }
}

function requireValue(args, name) {
  const value = args[name]
  if (!value) fail(`Missing --${name}`)
  return value
}

function validateIdentity(sourceRevision, releaseTag) {
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) fail('source revision must be a full lowercase Git SHA')
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(releaseTag)) fail('release tag must be vX.Y.Z')
}

function validateSubject(name, subject) {
  if (!/^ghcr\.io\/enterpriseglue\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/.test(subject)) {
    fail(`${name} must be an immutable EnterpriseGlue GHCR digest reference`)
  }
}

async function walkFiles(root, relative = '') {
  const directory = path.join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryRelative = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(root, entryRelative))
    else if (entry.isFile()) files.push(entryRelative)
  }
  return files
}

async function digestFile(file) {
  const contents = await readFile(file)
  return createHash('sha256').update(contents).digest('hex')
}

async function collectArtifacts(artifactDirectory) {
  const files = (await walkFiles(artifactDirectory)).filter((file) => file.endsWith('.tgz')).sort()
  for (const pattern of REQUIRED_ARTIFACTS) {
    const matches = files.filter((file) => pattern.test(file))
    if (matches.length !== 1) fail(`Expected exactly one candidate artifact matching ${pattern}`)
  }
  if (files.length !== REQUIRED_ARTIFACTS.length) {
    fail(`Expected ${REQUIRED_ARTIFACTS.length} candidate artifacts, found ${files.length}`)
  }
  return Promise.all(files.map(async (file) => {
    const absolute = path.join(artifactDirectory, file)
    const metadata = await stat(absolute)
    return {
      path: file,
      sha256: await digestFile(absolute),
      size: metadata.size,
    }
  }))
}

function subjectsFromArgs(args) {
  return Object.fromEntries(REQUIRED_SUBJECTS.map((name) => {
    const subject = requireValue(args, name)
    validateSubject(name, subject)
    return [name, { subject }]
  }))
}

async function createReceipt(args) {
  const sourceRevision = requireValue(args, 'source-ref')
  const releaseTag = requireValue(args, 'release-tag')
  const artifactDirectory = path.resolve(requireValue(args, 'artifacts'))
  const output = path.resolve(requireValue(args, 'output'))
  validateIdentity(sourceRevision, releaseTag)

  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    status: 'qualified',
    sourceRevision,
    releaseTag,
    publicationPerformed: false,
    subjects: subjectsFromArgs(args),
    artifacts: await collectArtifacts(artifactDirectory),
  }
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

async function verifyReceipt(args) {
  const receiptPath = path.resolve(requireValue(args, 'receipt'))
  const artifactDirectory = path.resolve(requireValue(args, 'artifacts'))
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  if (receipt.schemaVersion !== SCHEMA_VERSION) fail(`Unsupported candidate schema ${receipt.schemaVersion}`)
  if (receipt.status !== 'qualified' || receipt.publicationPerformed !== false) {
    fail('Candidate receipt must be qualified and pre-publication')
  }
  validateIdentity(receipt.sourceRevision, receipt.releaseTag)
  if (args['source-ref'] && receipt.sourceRevision !== args['source-ref']) fail('Candidate source revision mismatch')
  if (args['release-tag'] && receipt.releaseTag !== args['release-tag']) fail('Candidate release tag mismatch')
  if (!receipt.subjects || Object.keys(receipt.subjects).sort().join(',') !== [...REQUIRED_SUBJECTS].sort().join(',')) {
    fail('Candidate receipt has an incomplete subject set')
  }
  for (const name of REQUIRED_SUBJECTS) validateSubject(name, receipt.subjects[name]?.subject)

  const actualArtifacts = await collectArtifacts(artifactDirectory)
  if (JSON.stringify(receipt.artifacts) !== JSON.stringify(actualArtifacts)) {
    fail('Candidate artifact checksums or inventory do not match the receipt')
  }
  return receipt
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2))
  let receipt
  if (command === 'create') receipt = await createReceipt(args)
  else if (command === 'verify') receipt = await verifyReceipt(args)
  else fail('usage: release-candidate-receipt.mjs <create|verify> [arguments]')
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

export { SCHEMA_VERSION, collectArtifacts, createReceipt, verifyReceipt }
