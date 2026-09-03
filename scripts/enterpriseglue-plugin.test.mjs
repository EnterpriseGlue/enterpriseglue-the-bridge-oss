import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { classifyChangedFiles } from '../plugins/enterpriseglue-dev-workflows/skills/enterpriseglue-pr-readiness/scripts/collect-pr-readiness.mjs'
import { pngDimensions } from '../plugins/enterpriseglue-dev-workflows/skills/enterpriseglue-ui-evidence/scripts/audit-screenshots.mjs'
import { selectAuthzLanes } from '../plugins/enterpriseglue-dev-workflows/skills/enterpriseglue-access-governance-verify/scripts/select-authz-lanes.mjs'
import { analyzeParity } from '../plugins/enterpriseglue-dev-workflows/skills/enterpriseglue-contract-parity/scripts/check-contract-parity.mjs'

const root = new URL('..', import.meta.url).pathname
const pluginRoot = join(root, 'plugins/enterpriseglue-dev-workflows')
const expectedSkills = [
  'enterpriseglue-access-governance-verify',
  'enterpriseglue-changelog',
  'enterpriseglue-ci-compare',
  'enterpriseglue-ci-debug',
  'enterpriseglue-cleanup',
  'enterpriseglue-contract-parity',
  'enterpriseglue-deps',
  'enterpriseglue-documentation-governance',
  'enterpriseglue-hotfix',
  'enterpriseglue-license',
  'enterpriseglue-local-deploy',
  'enterpriseglue-new-change',
  'enterpriseglue-oss-to-ee',
  'enterpriseglue-plugin-development',
  'enterpriseglue-post-ship-watch',
  'enterpriseglue-pr-readiness',
  'enterpriseglue-release',
  'enterpriseglue-release-publish-watch',
  'enterpriseglue-security-check',
  'enterpriseglue-ship',
  'enterpriseglue-status',
  'enterpriseglue-sync-ee',
  'enterpriseglue-test',
  'enterpriseglue-ui-evidence',
]

test('repository marketplace exposes the validated EnterpriseGlue plugin', () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'))
  const marketplace = JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8'))
  assert.equal(manifest.name, 'enterpriseglue-dev-workflows')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:\+[a-z0-9.-]+)?$/)
  assert.equal(manifest.skills, './skills/')
  assert.equal(manifest.license, 'Apache-2.0')
  const entry = marketplace.plugins.find((candidate) => candidate.name === manifest.name)
  assert.deepEqual(entry.source, { source: 'local', path: './plugins/enterpriseglue-dev-workflows' })
  assert.equal(entry.policy.installation, 'AVAILABLE')
  assert.equal(entry.policy.authentication, 'ON_INSTALL')
})

test('CI and contributor documentation keep the versioned plugin validated and installable', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const contributing = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8')
  const documentation = readFileSync(join(root, 'docs/development/codex-workflow-plugin.md'), 'utf8')
  assert.match(workflow, /pnpm run test:codex-plugin/)
  assert.match(workflow, /pnpm run guard:documentation-boundary/)
  assert.match(contributing, /codex-workflow-plugin\.md/)
  assert.match(documentation, /codex plugin marketplace add/)
  assert.match(documentation, /enterpriseglue-dev-workflows@enterpriseglue/)
  assert.match(documentation, /documentation-governance/)
})

test('all versioned skills have portable instructions and UI metadata', () => {
  for (const skill of expectedSkills) {
    const skillRoot = join(pluginRoot, 'skills', skill)
    const instructions = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
    const metadata = readFileSync(join(skillRoot, 'agents/openai.yaml'), 'utf8')
    assert.match(instructions, new RegExp(`^name: ${skill}$`, 'm'), `${skill} name`)
    assert.match(instructions, /^description: .{30,}$/m, `${skill} description`)
    assert.doesNotMatch(instructions, /\[TODO:|\/Users\/|\/home\//, `${skill} portability`)
    assert.match(metadata, /^interface:$/m, `${skill} metadata`)
    assert.match(metadata, new RegExp(`\\$${skill}\\b`), `${skill} default prompt`)
  }
})

test('OSS delivery has no write path to the retired EE repository', () => {
  const workflowRoot = join(root, '.github/workflows')
  const workflowText = readdirSync(workflowRoot)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => readFileSync(join(workflowRoot, name), 'utf8'))
    .join('\n')

  assert.equal(existsSync(join(workflowRoot, 'notify-ee-oss-release.yml')), false)
  assert.doesNotMatch(workflowText, /EnterpriseGlue\/enterpriseglue-the-bridge-ee/)
  assert.doesNotMatch(workflowText, /EE_DISPATCH_TOKEN|OSS_EE_SYNC_TOKEN/)

  const bootGuard = readFileSync(join(root, 'scripts/check-plugin-boot-mode.sh'), 'utf8')
  assert.doesNotMatch(bootGuard, /MODE.*ee|EE plugin boot path/)

  for (const skill of ['enterpriseglue-oss-to-ee', 'enterpriseglue-sync-ee']) {
    const instructions = readFileSync(join(pluginRoot, 'skills', skill, 'SKILL.md'), 'utf8')
    assert.match(instructions, /Do not create or modify EE worktrees/)
    assert.match(instructions, /owning plugin repository/)
  }
})

test('PR readiness classifies contract, persistence, UI, and release surfaces', () => {
  const result = classifyChangedFiles([
    '.release-notes/change.json',
    'packages/shared/src/schemas/platform-admin/config.ts',
    'packages/shared/src/infrastructure/persistence/migrations/Example.ts',
    'packages/frontend-host/src/Page.tsx',
    'docs/development/example.md',
  ])
  assert.equal(result.releaseFragments.length, 1)
  assert.equal(result.api, true)
  assert.equal(result.database, true)
  assert.equal(result.ui, true)
  assert.equal(result.docs, true)
})

test('UI evidence helper reads canonical PNG dimensions', () => {
  const buffer = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer)
  buffer.writeUInt32BE(1440, 16)
  buffer.writeUInt32BE(900, 20)
  assert.deepEqual(pngDimensions(buffer), { width: 1440, height: 900 })
})

test('authorization selector includes identity, browser, Operaton, and database lanes', () => {
  const lanes = selectAuthzLanes([
    'packages/shared/src/services/platform-admin/identityProviderService.ts',
    'packages/frontend-host/src/features/platform-admin/access/Page.tsx',
    'packages/shared/src/infrastructure/persistence/migrations/Backstop.ts',
    'test/e2e/operaton-container/customer-sidecar-backstop.test.mjs',
  ])
  for (const lane of ['structure', 'identity', 'protocols', 'browser', 'accessibility', 'operatonBackstop', 'databasePortability']) {
    assert.ok(lanes.includes(lane), `missing ${lane}`)
  }
})

test('contract parity reports missing tests for an undocumented public schema change', () => {
  const result = analyzeParity(['packages/shared/src/schemas/platform-admin/example.ts'])
  assert.equal(result.surfaces.api, true)
  assert.ok(result.findings.some((finding) => finding.code === 'missing-tests' && finding.severity === 'error'))
  assert.ok(result.findings.some((finding) => finding.code === 'missing-docs'))
})
