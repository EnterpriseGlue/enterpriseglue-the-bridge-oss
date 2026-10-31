import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { seedExactGitProviders } from './managed-shard-bootstrap.mjs'

import {
  assertBootstrapEnabled,
  assertBoundedReceipt,
  canonicalJson,
  classifyStartingState,
  createBootstrapReceipt,
  migrationInventorySha256,
  parseManagedShardBootstrapManifest,
} from './managed-shard-bootstrap-contract.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = parseManagedShardBootstrapManifest(JSON.parse(await readFile(path.join(root, 'infra/database/managed-shard-bootstrap-manifest.json'), 'utf8')))

function enabledEnvironment(overrides = {}) {
  return {
    EG_MANAGED_SHARD_BOOTSTRAP_ENABLED: 'true',
    DATABASE_TYPE: 'postgres',
    EG_MANAGED_SHARD_TARGET_TENANCY_MODE: 'pooled',
    EG_TENANCY_MODE: 'single',
    EG_MANAGED_SHARD_ID: 'staging-shard-a1',
    EG_POSTGRES_RUNTIME_ROLE: 'enterpriseglue_runtime',
    ADMIN_EMAIL: 'bootstrap-admin@example.test',
    ...overrides,
  }
}

test('manifest pins the exact predecessor and is default off', () => {
  assert.equal(manifest.enabledByDefault, false)
  assert.equal(manifest.predecessor.releaseTag, 'v0.24.2')
  assert.equal(manifest.predecessor.sourceRevision, '785b5ab890aba315f6c3944ace0edcc3ff99d20f')
  assert.equal(manifest.predecessor.backendSubject, 'ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend@sha256:21b196a9ece726dac9f6a492cbb030c9dab6efadedf1f3f5ac842219027a3646')
  assert.deepEqual(manifest.predecessor.migrationInventory, {
    through: 1700000000130,
    count: 132,
    sha256: 'e525e9f9fe8d66498aeea6beb03d6257274de3a38a7b48819de6edccf02ecb16',
  })
  assert.equal(manifest.postcondition.roleProfile, 'restricted-owner-and-runtime-no-memberships/v1')
  assert.equal(manifest.postcondition.runtimeGrant, 'exact-owner-runtime-relation-default-and-no-column-acls/v2')
  assert.equal(manifest.postcondition.seedProfile, 'enterpriseglue-managed-shard-seeds/v2')
  assert.deepEqual(manifest.postcondition.expectedSequences, ['migrations_id_seq'])
  assert.ok(manifest.postcondition.seededRelations.includes('permissions'))
  assert.ok(manifest.postcondition.seededRelations.includes('audit_logs'))
  assert.equal(manifest.postcondition.ordinaryDataPolicy, 'all-other-predecessor-entity-tables-empty/v1')
})

test('bootstrap requires an explicit pooled-PostgreSQL controller invocation', () => {
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ EG_MANAGED_SHARD_BOOTSTRAP_ENABLED: undefined }), manifest), /disabled/)
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ DATABASE_TYPE: 'oracle' }), manifest), /pooled PostgreSQL/)
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ EG_TENANCY_MODE: 'pooled' }), manifest), /execution tenancy mode/)
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ EG_MANAGED_SHARD_ID: '../other' }), manifest), /stable lowercase shard identity/)
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ EG_POSTGRES_RUNTIME_ROLE: 'pg_owner' }), manifest), /restricted runtime login/)
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ ADMIN_EMAIL: undefined }), manifest), /explicit valid bootstrap administrator email/)
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ ADMIN_EMAIL: 'not-an-email' }), manifest), /explicit valid bootstrap administrator email/)
  assert.throws(() => assertBootstrapEnabled(enabledEnvironment({ GITHUB_CLIENT_SECRET: 'must-not-seed' }), manifest), /forbids mutable Git provider credential input/)
  assert.doesNotThrow(() => assertBootstrapEnabled(enabledEnvironment(), manifest))
})

test('fresh Git provider seeds retain exact defaults and equal timestamps when the clock advances', async (context) => {
  let clock = 1700000000000
  const now = context.mock.method(Date, 'now', () => ++clock)
  const writes = []
  const source = { getRepository(name) {
    assert.equal(name, 'GitProvider')
    return { count: async () => 0, insert: async (rows) => writes.push(rows) }
  } }
  try {
    await seedExactGitProviders(source, manifest)
    assert.equal(now.mock.callCount(), 1)
    assert.equal(writes.length, 1, 'all defaults must use one atomic insert')
    const rows = writes[0]
    assert.equal(rows.length, 4)
    assert.equal(new Set(rows.map(row => row.id)).size, 4)
    for (const row of rows) {
      assert.match(row.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
      assert.equal(row.createdAt, 1700000000001)
      assert.equal(row.updatedAt, row.createdAt)
    }
    assert.deepEqual(rows.map(({ id, createdAt, updatedAt, ...defaults }) => defaults), manifest.postcondition.gitProviders)
  } finally {
    now.mock.restore()
  }
})

test('fresh Git provider seeding refuses existing rows and an invalid clock before writing', async (context) => {
  let writes = 0
  const source = (count) => ({ getRepository: () => ({ count: async () => count, insert: async () => { writes++ } }) })
  await assert.rejects(seedExactGitProviders(source(1), manifest), /requires an empty relation/)
  const now = context.mock.method(Date, 'now', () => Number.NaN)
  try { await assert.rejects(seedExactGitProviders(source(0), manifest), /clock is invalid/) }
  finally { now.mock.restore() }
  assert.equal(writes, 0)
})

test('classifier accepts only a pristine schema or the exact signed ledger', () => {
  assert.equal(classifyStartingState({ schemaExists: false }, manifest), 'pristine-schema')
  assert.equal(classifyStartingState({ schemaExists: true, ledgerExists: false, ledger: [], relations: [], policies: [] }, manifest), 'pristine-schema')
  assert.throws(() => classifyStartingState({ schemaExists: true, ledgerExists: false, ledger: [], relations: [{ name: 'users' }], policies: [] }, manifest), /objects without a populated migration ledger/)
  assert.throws(() => classifyStartingState({ schemaExists: true, ledgerExists: true, ledger: [], relations: [{ name: 'migrations' }], policies: [] }, manifest), /objects without a populated migration ledger/)

  const inventory = [{ name: 'First1700000000000', timestamp: 1700000000000 }, { name: 'Last1700000000130', timestamp: 1700000000130 }]
  const localManifest = structuredClone(manifest)
  localManifest.predecessor.migrationInventory = { through: 1700000000130, count: 2, sha256: migrationInventorySha256(inventory) }
  assert.equal(classifyStartingState({ schemaExists: true, ledgerExists: true, ledger: inventory, relations: [{ name: 'migrations' }], policies: [] }, localManifest), 'exact-bootstrap-0130')
  assert.throws(() => classifyStartingState({ schemaExists: true, ledgerExists: true, ledger: inventory.slice(0, 1), relations: [{ name: 'migrations' }], policies: [] }, localManifest), /not the exact signed 0130/)
  assert.throws(() => classifyStartingState({ schemaExists: true, ledgerExists: true, ledger: inventory, relations: [{ name: 'migrations' }, { name: 'release_effect_cohorts' }], policies: [] }, localManifest), /reserved for a later schema epoch/)
})

test('receipt is bounded, stable, and contains no secret-shaped field', () => {
  const receipt = createBootstrapReceipt({
    manifest,
    manifestSha256: 'a'.repeat(64),
    shardId: 'staging-shard-a1',
    action: 'bootstrapped',
    schema: 'main',
    role: 'enterpriseglue_owner',
    runtimeRole: 'enterpriseglue_runtime',
    relationCount: 150,
    policyCount: 30,
  })
  assert.equal(receipt.schemaVersion, 'enterpriseglue-managed-shard-bootstrap-receipt/v1')
  assert.equal(receipt.predecessor.backendDigest, manifest.predecessor.backendSubject.split('@')[1])
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) < manifest.execution.maximumReceiptBytes)
  assert.doesNotThrow(() => assertBoundedReceipt(receipt, manifest))
  assert.throws(() => assertBoundedReceipt({ ...receipt, password: 'do-not-record' }, manifest), /forbidden field password/)
  assert.equal(canonicalJson(receipt), canonicalJson(structuredClone(receipt)))
})

test('runner never invokes TypeORM synchronize and executes only the signed schema plan', async () => {
  const runner = await readFile(path.join(root, 'scripts/managed-shard-bootstrap.mjs'), 'utf8')
  const dockerfile = await readFile(path.join(root, 'infra/docker/managed-shard-bootstrap/Dockerfile'), 'utf8')
  const postgresHarness = await readFile(path.join(root, 'scripts/run-managed-shard-bootstrap-postgres.sh'), 'utf8')
  assert.doesNotMatch(runner, /\.synchronize\s*\(/)
  assert.match(runner, /dataSource\.driver\.createSchemaBuilder\(\)\.log\(\)/)
  assert.match(runner, /digest !== manifest\.execution\.schemaPlan\.sha256/)
  assert.match(runner, /for \(const migration of supplemental\) await migration\.up\(runner\)/)
  assert.match(runner, /const executor = new MigrationExecutor\(dataSource, runner\)/)
  assert.match(runner, /executor\.transaction = manifest\.execution\.transaction/)
  assert.match(runner, /executor\.fake = true/)
  assert.match(runner, /await executor\.executePendingMigrations\(\)/)
  assert.ok(runner.indexOf('await executor.executePendingMigrations()') < runner.indexOf('await runner.commitTransaction()'))
  assert.ok(runner.indexOf('await assertExactRoleSafety(runner') < runner.indexOf('await runner.createSchema(schema, true)'))
  assert.match(runner, /assertBootstrapEnabled\(process\.env, manifest\)/)
  assert.match(runner, /await verifyPassword\(adminPassword, users\[0\]\.passwordHash\)/)
  assert.match(runner, /canonicalJson\(auditResourceIds\) !== canonicalJson\(membershipIds\)/)
  assert.match(runner, /Managed shard ordinary business relation is not empty/)
  assert.match(runner, /Managed shard direct column privileges are forbidden/)
  assert.match(runner, /Number\(row\.updatedAt\) !== Number\(row\.createdAt\)/)
  assert.doesNotMatch(runner, /gitProvidersModule\.seedGitProviders|relocateGitProvidersToDefaultTenant/)
  assert.match(dockerfile, /^FROM ghcr\.io\/enterpriseglue\/enterpriseglue-the-bridge-oss-backend@sha256:21b196a9/m)
  const upgradedPackages = dockerfile.match(/^RUN apk add --no-cache --upgrade \\\n((?:[ \t]+[^\n]*\\\n)*[ \t]+[^\n]*)(?:\n|$)/m)?.[1]
  assert.deepEqual(upgradedPackages?.split(/\\\n/).map((line) => line.trim()), [
    "'nodejs-26=26.12.1-r2' 'c-ares>=1.34.9-r0'",
    "'ca-certificates-bundle>=20260909-r3'",
    "'zlib>=1.3.2.1_rc20260921-r0'",
    "'glibc-2.44>=2.44-r8'",
    "'glibc-2.44-dev>=2.44-r8'",
    "'glibc-2.44-locale-posix>=2.44-r8'",
    "'ld-linux-2.44>=2.44-r8'",
    "'libcurl-openssl4>=8.23.0-r0'",
    "'libbrotlicommon1>=1.2.0-r7' 'libbrotlidec1>=1.2.0-r7' 'libbrotlienc1>=1.2.0-r7'",
    'wget',
    "'libcrypt1-2.44>=2.44-r8'",
  ])
  assert.match(dockerfile, /RUN apk del --no-network node-gyp && ! apk info -e node-gyp/)
  assert.doesNotMatch(dockerfile, /EG_MANAGED_SHARD_BOOTSTRAP_ENABLED/)
  assert.match(postgresHarness, /postgres:16\.15-alpine3\.24@sha256:cf78e766/)
  assert.match(postgresHarness, /Rejected superuser mutated the pristine schema/)
  assert.match(postgresHarness, /Rejected missing ADMIN_EMAIL mutated the pristine schema/)
  assert.match(postgresHarness, /Rejected invalid ADMIN_EMAIL mutated the pristine schema/)
  assert.match(postgresHarness, /GRANT REFERENCES \(email\)/)
})
