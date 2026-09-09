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
