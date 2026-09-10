import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const chart = path.join(root, 'infra/kubernetes/helm/enterpriseglue-host')
const sha256 = 'a'.repeat(64)
const releaseEffectInventorySha256 = 'c35183c2dee4ec8477948fdcd00d8b0b5e10de051d6e5ce9001950e2dac36087'
const receiptReleaseId = `sha256:${'1'.repeat(64)}`
const enabled = {
  enabled: true,
  configMapName: 'api-platform-bundle-a',
  configMapKey: 'global-signup.json',
  expectedSha256: sha256,
  mode: 'validate',
  secret: { name: 'api-platform-credential-a', key: 'client-secret' },
}

async function render(t, values = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'eg-api-config-chart-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'values.json')
  await writeFile(file, JSON.stringify(values))
  return spawnSync('helm', ['template', 'enterpriseglue', chart, '-f', path.join(chart, 'ci-values.yaml'), '-f', file], { cwd: root, encoding: 'utf8' })
}

function documents(rendered) {
  return rendered.split(/^---\s*$/m).filter((document) => document.trim())
}

for (const mode of ['validate', 'apply']) {
  test(`apiConfigBundle ${mode} mounts only the declared file and credential in the split API`, async (t) => {
    const result = await render(t, { apiConfigBundle: { ...enabled, mode } })
    assert.equal(result.status, 0, result.stderr)
    const api = documents(result.stdout).find((document) => document.includes('# Source: enterpriseglue-host/templates/backend-deployment.yaml'))
    assert.ok(api)
    for (const [name, value] of Object.entries({
      EG_CONFIG_BUNDLE_PATH: '/etc/enterpriseglue/platform-config/global-signup.json',
      EG_CONFIG_BOOTSTRAP_MODE: mode,
      EG_CONFIG_EXPECTED_SHA256: sha256,
      EG_CONFIG_EXPECTED_TENANT_SCOPE: 'platform',
      EG_CONFIG_REQUIRE_SECRET_PREFLIGHT: 'true',
      EG_CONFIG_FAIL_CLOSED: 'true',
      EG_CONFIG_SECRET_PROVIDER: 'env',
    })) {
      assert.ok(api.includes(`- name: ${name}\n              value: "${value}"`), name)
      assert.equal(result.stdout.match(new RegExp(`- name: ${name}\\n`, 'g'))?.length, 1, name)
    }
    assert.match(api, /name: EG_CONFIG_BUNDLE_SECRET\n\s+valueFrom:\n\s+secretKeyRef:\n\s+name: "api-platform-credential-a"\n\s+key: "client-secret"\n\s+optional: false/)
    assert.match(api, /name: api-config-bundle\n\s+mountPath: \/etc\/enterpriseglue\/platform-config\n\s+readOnly: true/)
    assert.match(api, /name: api-config-bundle\n\s+configMap:\n\s+name: "api-platform-bundle-a"\n\s+optional: false\n\s+items:\n\s+- key: "global-signup.json"\n\s+path: "global-signup.json"/)
    assert.match(api, /enterpriseglue.io\/api-config-bundle-contract: v1/)
    assert.ok(api.includes(`enterpriseglue.io/api-config-bundle-sha256: "${sha256}"`))
    assert.match(api, /name: EG_RUNTIME_ROLE\n\s+value: "api"/)
    assert.doesNotMatch(api, /secretRef: \{ name: api-platform-credential-a/)
    const otherDocuments = documents(result.stdout).filter((document) => document !== api)
    assert.ok(otherDocuments.some((document) => document.includes('component: worker')))
    assert.ok(otherDocuments.some((document) => document.includes('component: migration')))
    assert.ok(otherDocuments.some((document) => document.includes('component: preflight')))
    assert.ok(otherDocuments.some((document) => document.includes('component: frontend')))
    for (const document of otherDocuments) {
      assert.doesNotMatch(document, /EG_CONFIG_|api-platform-(bundle|credential)-a|api-config-bundle|platform-config|global-signup\.json/)
    }
  })
}

test('disabled API bundle delivery leaves every rendered workload unchanged', async (t) => {
  const baseline = await render(t)
  const disabled = await render(t, { apiConfigBundle: { ...enabled, enabled: false } })
  assert.equal(baseline.status, 0, baseline.stderr)
  assert.equal(disabled.status, 0, disabled.stderr)
  assert.equal(disabled.stdout, baseline.stdout)
  assert.doesNotMatch(disabled.stdout, /EG_CONFIG_|api-config-bundle|platform-config/)
})

test('pooled PostgreSQL profile always renders the signed bridge owner and verify-only runtimes', async (t) => {
  const result = await render(t, {
    database: {
      profile: { databaseType: 'postgres', tenancyMode: 'pooled' },
      migration: { enabled: false, runtimeRole: 'eg_runtime' },
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runSchemaEpochOwnerMigrations/)
  assert.match(result.stdout, /runSchemaEpochPreflight/)
  assert.match(result.stdout, /dist\/packages\/shared\/dist\/db\/run-migrations\.js/)
  assert.doesNotMatch(result.stdout, /dist\/packages\/shared\/src\/db\/run-migrations\.js/)
  assert.doesNotMatch(result.stdout, /runMigrations\(\{mode:'apply'\}\)/)
  assert.equal(result.stdout.match(/name: EG_DATABASE_STARTUP_MODE\n\s+value: "verify"/g)?.length, 2)
  assert.match(result.stdout, /secretRef: \{ name: enterpriseglue-migration-secrets \}/)
  assert.equal(result.stdout.match(/name: EG_POSTGRES_RUNTIME_ROLE/g)?.length, 2)
  assert.match(result.stdout, /name: EG_POSTGRES_RUNTIME_ROLE\n\s+value: "eg_runtime"/)
  assert.equal(result.stdout.match(/name: EG_TENANCY_MODE\n\s+value: "pooled"/g)?.length, 4)
  assert.equal(result.stdout.match(/name: DATABASE_TYPE\n\s+value: "postgres"/g)?.length, 4)
  assert.doesNotMatch(result.stdout, /^\s*- name: TENANCY_MODE$/m)
})

test('non-target profiles retain migration.enabled and never require the bridge owner secret', async (t) => {
  const single = await render(t, {
    database: {
      profile: { databaseType: 'postgres', tenancyMode: 'single' },
      migrationSecretName: 'unused-migration-secret',
      migration: { enabled: false },
      preflight: { enabled: false },
    },
  })
  assert.equal(single.status, 0, single.stderr)
  assert.doesNotMatch(single.stdout, /runSchemaEpochOwnerMigrations|runMigrations\(\{mode:'apply'\}\)|unused-migration-secret/)
  assert.equal(single.stdout.match(/name: EG_DATABASE_STARTUP_MODE\n\s+value: "apply"/g)?.length, 2)

  const oracle = await render(t, {
    database: { profile: { databaseType: 'oracle', tenancyMode: 'single' } },
  })
  assert.equal(oracle.status, 0, oracle.stderr)
  assert.match(oracle.stdout, /runMigrations\(\{mode:'apply'\}\)/)
  assert.doesNotMatch(oracle.stdout, /runSchemaEpochOwnerMigrations/)
})

test('bridge profile rejects incomplete profile and a missing owner secret', async (t) => {
  for (const values of [
    { database: { profile: { databaseType: 'postgres', tenancyMode: '' } } },
    { database: { profile: { databaseType: 'postgres', tenancyMode: 'pooled' }, migrationSecretName: '' } },
  ]) {
    const result = await render(t, values)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

test('database proxy sidecars do not inherit API bootstrap credentials or mounts', async (t) => {
  const result = await render(t, {
    apiConfigBundle: enabled,
    database: { connectionProxy: { enabled: true, image: `registry.example/proxy@sha256:${'b'.repeat(64)}` } },
  })
  assert.equal(result.status, 0, result.stderr)
  const api = documents(result.stdout).find((document) => document.includes('# Source: enterpriseglue-host/templates/backend-deployment.yaml'))
  assert.ok(api)
  const proxy = api.slice(api.indexOf('- name: database-connection-proxy'), api.indexOf('- name: backend'))
  assert.match(proxy, /name: database-connection-proxy/)
  assert.doesNotMatch(proxy, /EG_CONFIG_|api-platform-(bundle|credential)-a|api-config-bundle|platform-config/)
})

for (const [label, override] of [
  ['missing ConfigMap', { configMapName: '' }],
  ['missing hash', { expectedSha256: '' }],
  ['malformed hash', { expectedSha256: 'invalid' }],
  ['wrong bootstrap mode', { mode: 'disabled' }],
  ['missing Secret', { secret: { name: '', key: 'client-secret' } }],
  ['missing Secret key', { secret: { name: 'api-only', key: '' } }],
  ['unsafe file path', { configMapKey: '../global-signup.json' }],
  ['unsafe mount name', { configMapName: 'INVALID_NAME' }],
  ['empty DNS name segment', { configMapName: 'api..bundle' }],
  ['overlong Secret DNS label', { secret: { name: 'a'.repeat(64), key: 'client-secret' } }],
  ['unsafe secret key', { secret: { name: 'api-only', key: 'bad/key' } }],
  ['arbitrary env override', { secret: { name: 'api-only', key: 'client-secret', env: 'NODE_OPTIONS' } }],
  ['unknown bundle setting', { failClosed: false }],
  ['unknown volume mount', { mountPath: '/tmp' }],
]) {
  test(`apiConfigBundle rejects ${label} before rendering a workload`, async (t) => {
    const result = await render(t, { apiConfigBundle: { ...enabled, ...override } })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  })
}

test('API-only bootstrap rejects the combined API/worker runtime', async (t) => {
  const result = await render(t, { apiConfigBundle: enabled, workers: { enabled: false } })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /requires the split API runtime/)
})

test('bootstrap rejects shared ConfigMap and all existing shared/job Secret aliases', async (t) => {
  const config = await render(t, { apiConfigBundle: { ...enabled, configMapName: 'enterpriseglue-config' } })
  assert.notEqual(config.status, 0)
  assert.match(config.stderr, /dedicated API-only ConfigMap/)
  for (const name of ['enterpriseglue-secrets', 'enterpriseglue-migration-secrets', 'enterpriseglue-preflight-secrets', 'enterpriseglue-plugin-manager']) {
    const result = await render(t, { apiConfigBundle: { ...enabled, secret: { ...enabled.secret, name } } })
    assert.notEqual(result.status, 0, name)
    assert.match(result.stderr, /dedicated API-only Secret/)
  }
})

test('bootstrap rollout annotations cannot be overridden by global pod annotations', async (t) => {
  for (const key of ['enterpriseglue.io/api-config-bundle-contract', 'enterpriseglue.io/api-config-bundle-sha256']) {
    const result = await render(t, { apiConfigBundle: enabled, podAnnotations: { [key]: 'wrong' } })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /annotations cannot be overridden/)
  }
})

test('signed chart publishes its generic capability without provider-specific configuration', async () => {
  const metadata = await readFile(path.join(chart, 'Chart.yaml'), 'utf8')
  assert.match(metadata, /enterpriseglue.io\/api-config-bundle-contract: v1/)
  const schema = JSON.parse(await readFile(path.join(chart, 'values.schema.json'), 'utf8'))
  assert.equal(schema.properties.apiConfigBundle.additionalProperties, false)
  assert.deepEqual(schema.properties.apiConfigBundle.properties.mode.enum, ['validate', 'apply'])
  const template = await readFile(path.join(chart, 'templates/backend-deployment.yaml'), 'utf8')
  assert.doesNotMatch(template, /accounts\.google|googleapis|cloud-signup-google|GOOGLE_CLIENT/)
})

test('managed pooled PostgreSQL opens the exact effect cohort after preflight and before workloads', async (t) => {
  const inventorySha256 = releaseEffectInventorySha256
  const result = await render(t, {
    database: {
      profile: { databaseType: 'postgres', tenancyMode: 'pooled' },
      migration: { enabled: false },
      preflight: { enabled: false },
      releaseEffectCohort: {
        enabled: true,
        releaseId: receiptReleaseId,
        cohortEpoch: 41,
        inventoryVersion: 'release-effect-inventory.enterpriseglue.io/v1',
        inventorySha256,
      },
    },
    serviceAccounts: { cohort: { automountServiceAccountToken: true } },
  })
  assert.equal(result.status, 0, result.stderr)
  const rendered = documents(result.stdout)
  const jobs = Object.fromEntries(['migration', 'preflight', 'cohort'].map((component) => [
    component,
    rendered.find((document) => document.includes('kind: Job') && document.includes(`app.kubernetes.io/component: ${component}`)),
  ]))
  assert.match(jobs.migration, /helm\.sh\/hook-weight: "-20"/)
  assert.match(jobs.preflight, /helm\.sh\/hook-weight: "-10"/)
  assert.match(jobs.cohort, /helm\.sh\/hook-weight: "0"/)
  assert.match(jobs.cohort, /openConfiguredReleaseEffectCohort/)
  assert.match(jobs.cohort, /dist\/packages\/shared\/dist\/services\/platform-admin\/open-release-effect-cohort\.js/)
  assert.match(jobs.cohort, /secretRef: \{ name: enterpriseglue-secrets \}/)
  assert.doesNotMatch(jobs.cohort, /enterpriseglue-migration-secrets|runMigrations|synchronize|repair/)
  assert.match(jobs.cohort, /automountServiceAccountToken: false/)
  const cohortServiceAccount = rendered.find((document) => document.includes('kind: ServiceAccount') &&
    document.includes('app.kubernetes.io/component: cohort'))
  assert.match(cohortServiceAccount, /helm\.sh\/hook-delete-policy: before-hook-creation/)
  assert.doesNotMatch(cohortServiceAccount, /hook-succeeded/)

  for (const component of ['cohort', 'api', 'worker']) {
    const workload = component === 'cohort' ? jobs.cohort : rendered.find((document) =>
      document.includes('kind: Deployment') && document.includes(`app.kubernetes.io/component: ${component}`))
    assert.ok(workload, component)
    for (const [name, value] of Object.entries({
      EG_TENANT_PLACEMENT_RELEASE_ID: receiptReleaseId,
      EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH: '41',
      EG_RELEASE_EFFECT_EXPECTED_INVENTORY_VERSION: 'release-effect-inventory.enterpriseglue.io/v1',
      EG_RELEASE_EFFECT_EXPECTED_INVENTORY_SHA256: inventorySha256,
    })) assert.match(workload, new RegExp(`name: ${name}\\n\\s+value: "${value}"`), `${component}:${name}`)
    assert.match(workload, new RegExp(`enterpriseglue.io/release-effect-inventory-sha256: "${inventorySha256}"`))
  }
})

for (const [label, database] of [
  ['non-PostgreSQL profile', { profile: { databaseType: '', tenancyMode: 'pooled' } }],
  ['single tenancy', { profile: { databaseType: 'postgres', tenancyMode: 'single' } }],
  ['missing release', { releaseEffectCohort: { releaseId: '' } }],
  ['arbitrary release label', { releaseEffectCohort: { releaseId: 'saas-preview-1' } }],
  ['zero epoch', { releaseEffectCohort: { cohortEpoch: 0 } }],
  ['unknown inventory', { releaseEffectCohort: { inventoryVersion: '' } }],
  ['missing inventory hash', { releaseEffectCohort: { inventorySha256: '' } }],
  ['wrong receipt inventory hash', { releaseEffectCohort: { inventorySha256: 'd'.repeat(64) } }],
]) {
  test(`effect cohort rejects ${label}`, async (t) => {
    const base = {
      profile: { databaseType: 'postgres', tenancyMode: 'pooled' },
      migration: { enabled: true },
      preflight: { enabled: true },
      releaseEffectCohort: {
        enabled: true,
        releaseId: receiptReleaseId,
        cohortEpoch: 41,
        inventoryVersion: 'release-effect-inventory.enterpriseglue.io/v1',
        inventorySha256: releaseEffectInventorySha256,
      },
    }
    const result = await render(t, {
      database: {
        ...base,
        ...database,
        profile: { ...base.profile, ...database.profile },
        migration: { ...base.migration, ...database.migration },
        preflight: { ...base.preflight, ...database.preflight },
        releaseEffectCohort: { ...base.releaseEffectCohort, ...database.releaseEffectCohort },
      },
    })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  })
}

test('effect cohort rollout identity annotations cannot be overridden', async (t) => {
  const result = await render(t, {
    database: {
      profile: { databaseType: 'postgres', tenancyMode: 'pooled' },
      releaseEffectCohort: {
        enabled: true, releaseId: receiptReleaseId, cohortEpoch: 41,
        inventoryVersion: 'release-effect-inventory.enterpriseglue.io/v1', inventorySha256: releaseEffectInventorySha256,
      },
    },
    podAnnotations: { 'enterpriseglue.io/release-effect-cohort-epoch': '42' },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /cannot be overridden/)
})

for (const [label, database, serviceAccounts] of [
  ['application/migration Secret alias', { applicationSecretName: 'same-secret', migrationSecretName: 'same-secret' }, {}],
  ['application/preflight Secret alias', { applicationSecretName: 'same-secret', preflightSecretName: 'same-secret' }, {}],
  ['migration/preflight Secret alias', { migrationSecretName: 'same-secret', preflightSecretName: 'same-secret' }, {}],
  ['migration/preflight ServiceAccount alias', {}, { migration: { name: 'same-sa' }, preflight: { name: 'same-sa' } }],
  ['cohort/migration ServiceAccount alias', {}, { cohort: { name: 'same-sa' }, migration: { name: 'same-sa' } }],
  ['cohort/preflight ServiceAccount alias', {}, { cohort: { name: 'same-sa' }, preflight: { name: 'same-sa' } }],
]) {
  test(`managed bridge rejects ${label}`, async (t) => {
    const result = await render(t, {
      database: {
        profile: { databaseType: 'postgres', tenancyMode: 'pooled' },
        ...database,
        releaseEffectCohort: {
          enabled: true,
          releaseId: receiptReleaseId,
          cohortEpoch: 41,
          inventoryVersion: 'release-effect-inventory.enterpriseglue.io/v1',
          inventorySha256: releaseEffectInventorySha256,
        },
      },
      serviceAccounts,
    })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  })
}
