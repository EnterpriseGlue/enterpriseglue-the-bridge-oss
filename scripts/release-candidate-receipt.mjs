#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { canonicalJson, parseManagedShardBootstrapManifest } from './managed-shard-bootstrap-contract.mjs'

const SCHEMA_VERSION = 'enterpriseglue-release-candidate/v1'
const REQUIRED_SUBJECTS = [
  'backend',
  'frontend',
  'managedShardBootstrap',
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
  /^packages\/plugin\/enterpriseglue-enterprise-plugin-api-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/plugin\/enterpriseglue-plugin-sdk-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/plugin\/enterpriseglue-plugin-runtime-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/plugin\/enterpriseglue-plugin-installer-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/plugin\/enterpriseglue-plugin-manager-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/host\/enterpriseglue-shared-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/host\/enterpriseglue-backend-host-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^packages\/host\/enterpriseglue-frontend-host-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
  /^metadata\/schema-epoch-manifest\.json$/,
  /^metadata\/managed-shard-bootstrap-manifest\.json$/,
]
const SCHEMA_EPOCH_MANIFEST_PATH = 'metadata/schema-epoch-manifest.json'
const MANAGED_SHARD_BOOTSTRAP_MANIFEST_PATH = 'metadata/managed-shard-bootstrap-manifest.json'
const LEGACY_POLICY_PROFILE = 'legacy-tenant-context/v1'
const DUAL_POLICY_PROFILE = 'dual-context-compatibility/v1'
const EXPLICIT_POLICY_PROFILE = 'explicit-context/v1'

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
  const files = (await walkFiles(artifactDirectory))
    .filter((file) => file.endsWith('.tgz') || file === SCHEMA_EPOCH_MANIFEST_PATH || file === MANAGED_SHARD_BOOTSTRAP_MANIFEST_PATH)
    .sort()
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

async function readSchemaEpochManifest(artifactDirectory) {
  const manifest = JSON.parse(await readFile(path.join(artifactDirectory, SCHEMA_EPOCH_MANIFEST_PATH), 'utf8'))
  if (
    manifest?.schemaVersion !== 'enterpriseglue-schema-epoch/v1'
    || manifest?.id !== 'postgres-explicit-context-bridge-v1'
    || manifest?.roles?.applicationStartup?.mode !== 'verify-only'
    || manifest?.roles?.preflight?.mode !== 'verify-runtime-grant'
    || manifest?.roles?.ownerMigration?.mode !== 'apply-through-executable'
    || manifest?.roles?.ownerMigration?.from?.through !== 1700000000130
    || manifest?.roles?.ownerMigration?.from?.postgresPolicyProfile !== LEGACY_POLICY_PROFILE
    || manifest?.target?.databaseType !== 'postgres'
    || manifest?.target?.tenancyMode !== 'pooled'
    || manifest?.executableMigrationInventory?.through !== 1700000000131
    || manifest?.upgradeContract?.minimumDatabaseEpoch?.through !== 1700000000130
    || manifest?.upgradeContract?.minimumDatabaseEpoch?.count !== manifest?.roles?.ownerMigration?.from?.count
    || manifest?.upgradeContract?.minimumDatabaseEpoch?.sha256 !== manifest?.roles?.ownerMigration?.from?.sha256
    || manifest?.upgradeContract?.minimumDatabaseEpoch?.postgresPolicyProfile !== LEGACY_POLICY_PROFILE
    || manifest?.upgradeContract?.freshDatabase !== 'requires-separate-signed-bootstrap'
    || manifest?.upgradeContract?.emptyMigrationLedger !== 'requires-separate-signed-recovery'
    || manifest?.executableImplementationInventory?.algorithm !== 'sha256-source-v1'
    || manifest?.executableImplementationInventory?.purpose !== 'owner-transition-1700000000131-dual-context-closure/v1'
    || manifest?.roles?.ownerMigration?.runtimeGrant !== 'configured-role-release-effect-cohorts-select-insert-update/v1'
    || manifest?.executableImplementationInventory?.count !== 16
    || !/^[0-9a-f]{64}$/.test(manifest?.executableImplementationInventory?.sha256 || '')
    || manifest?.releaseEffectInventory?.version !== 'release-effect-inventory.enterpriseglue.io/v1'
    || !/^[0-9a-f]{64}$/.test(manifest?.releaseEffectInventory?.sha256 || '')
    || manifest?.roles?.ownerMigration?.through !== manifest.executableMigrationInventory.through
    || !Array.isArray(manifest?.acceptedDatabaseEpochs)
    || manifest.acceptedDatabaseEpochs.length !== 2
    || manifest.acceptedDatabaseEpochs[0]?.through !== 1700000000131
    || manifest.acceptedDatabaseEpochs[0]?.id !== 'pre-enforcement'
    || manifest.acceptedDatabaseEpochs[0]?.postgresPolicyProfile !== DUAL_POLICY_PROFILE
    || manifest.acceptedDatabaseEpochs[1]?.through !== 1700000000132
    || manifest.acceptedDatabaseEpochs[1]?.id !== 'post-enforcement'
    || manifest.acceptedDatabaseEpochs[1]?.postgresPolicyProfile !== EXPLICIT_POLICY_PROFILE
  ) fail('Candidate schema-epoch manifest is not the bounded dual-role compatibility bridge')
  return manifest
}

async function readManagedShardBootstrapManifest(artifactDirectory, schemaEpochManifest) {
  const manifest = parseManagedShardBootstrapManifest(JSON.parse(await readFile(path.join(artifactDirectory, MANAGED_SHARD_BOOTSTRAP_MANIFEST_PATH), 'utf8')))
  const predecessorEpoch = {
    ...manifest.predecessor.migrationInventory,
    postgresPolicyProfile: manifest.predecessor.postgresPolicyProfile,
  }
  if (canonicalJson(predecessorEpoch) !== canonicalJson(schemaEpochManifest.roles.ownerMigration.from)) {
    fail('Managed-shard bootstrap output does not equal the schema bridge owner predecessor')
  }
  return manifest
}

const deepCopy = (value) => JSON.parse(JSON.stringify(value))

function schemaEpochProjection(manifest, artifact) {
  return {
    manifestPath: SCHEMA_EPOCH_MANIFEST_PATH,
    manifestSha256: artifact?.sha256,
    id: manifest.id,
    applicationStartupMode: manifest.roles.applicationStartup.mode,
    preflightMode: manifest.roles.preflight.mode,
    ownerMigrationMode: manifest.roles.ownerMigration.mode,
    ownerMigrationFrom: deepCopy(manifest.roles.ownerMigration.from),
    ownerRuntimeGrant: manifest.roles.ownerMigration.runtimeGrant,
    freshDatabase: manifest.upgradeContract.freshDatabase,
    emptyMigrationLedger: manifest.upgradeContract.emptyMigrationLedger,
    executableThrough: manifest.executableMigrationInventory.through,
    executableImplementationSha256: manifest.executableImplementationInventory.sha256,
    executableImplementationPurpose: manifest.executableImplementationInventory.purpose,
    releaseEffectInventoryVersion: manifest.releaseEffectInventory.version,
    releaseEffectInventorySha256: manifest.releaseEffectInventory.sha256,
    acceptedDatabaseEpochs: deepCopy(manifest.acceptedDatabaseEpochs),
  }
}

function managedShardBootstrapProjection(manifest, artifact) {
  return {
    manifestPath: MANAGED_SHARD_BOOTSTRAP_MANIFEST_PATH,
    manifestSha256: artifact?.sha256,
    id: manifest.id,
    enabledByDefault: manifest.enabledByDefault,
    target: deepCopy(manifest.target),
    predecessor: deepCopy(manifest.predecessor),
    execution: deepCopy(manifest.execution),
    seedProfile: manifest.postcondition.seedProfile,
    runtimeGrant: manifest.postcondition.runtimeGrant,
  }
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

  const artifacts = await collectArtifacts(artifactDirectory)
  const schemaEpochManifest = await readSchemaEpochManifest(artifactDirectory)
  const managedShardBootstrapManifest = await readManagedShardBootstrapManifest(artifactDirectory, schemaEpochManifest)
  const schemaEpochArtifact = artifacts.find((artifact) => artifact.path === SCHEMA_EPOCH_MANIFEST_PATH)
  const managedShardBootstrapArtifact = artifacts.find((artifact) => artifact.path === MANAGED_SHARD_BOOTSTRAP_MANIFEST_PATH)
  if (!schemaEpochArtifact) fail('Candidate schema-epoch manifest is missing from the artifact inventory')
  if (!managedShardBootstrapArtifact) fail('Candidate managed-shard bootstrap manifest is missing from the artifact inventory')
  const subjects = subjectsFromArgs(args)
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    status: 'qualified',
    sourceRevision,
    releaseTag,
    publicationPerformed: false,
    subjects,
    schemaEpoch: schemaEpochProjection(schemaEpochManifest, schemaEpochArtifact),
    managedShardBootstrap: managedShardBootstrapProjection(managedShardBootstrapManifest, managedShardBootstrapArtifact),
    artifacts,
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
  const schemaEpochManifest = await readSchemaEpochManifest(artifactDirectory)
  const managedShardBootstrapManifest = await readManagedShardBootstrapManifest(artifactDirectory, schemaEpochManifest)
  const schemaEpochArtifact = actualArtifacts.find((artifact) => artifact.path === SCHEMA_EPOCH_MANIFEST_PATH)
  const managedShardBootstrapArtifact = actualArtifacts.find((artifact) => artifact.path === MANAGED_SHARD_BOOTSTRAP_MANIFEST_PATH)
  const expectedSchemaEpoch = schemaEpochProjection(schemaEpochManifest, schemaEpochArtifact)
  if (JSON.stringify(receipt.schemaEpoch) !== JSON.stringify(expectedSchemaEpoch)) {
    fail('Candidate schema-epoch receipt does not match the immutable manifest')
  }
  const expectedManagedShardBootstrap = managedShardBootstrapProjection(managedShardBootstrapManifest, managedShardBootstrapArtifact)
  if (JSON.stringify(receipt.managedShardBootstrap) !== JSON.stringify(expectedManagedShardBootstrap)) {
    fail('Candidate managed-shard bootstrap receipt does not match the immutable manifest')
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
