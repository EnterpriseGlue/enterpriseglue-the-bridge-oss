import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  renderReleaseNotes,
  recommendReleaseVersion,
  validateBaselineState,
  validateFragment,
  validatePathCoverage,
  validatePrClassification,
} from './release-notes.mjs'

const fragment = JSON.parse(
  readFileSync(new URL('../.release-notes/sso-engine-assignments.json', import.meta.url), 'utf8'),
)

test('the current feature release fragment satisfies the contract', () => {
  assert.equal(validateFragment(structuredClone(fragment)).id, 'sso-engine-assignments')
})

test('breaking API changes require breaking release classification', () => {
  const candidate = structuredClone(fragment)
  candidate.breaking = false
  assert.throws(() => validateFragment(candidate), /breaking API change/)
})

test('package impact must match its semantic version change', () => {
  const candidate = structuredClone(fragment)
  candidate.packages[0].impact = 'minor'
  assert.throws(() => validateFragment(candidate), /declares minor.*is patch/)
})

test('path-aware validation requires migration, API, security, config, UI, and package coverage', () => {
  const changedFiles = [
    'packages/shared/src/db/migrations/1700000000107-example.ts',
    'packages/enterprise-plugin-api/src/index.ts',
    'packages/backend-host/src/modules/auth/routes/login.ts',
    'packages/shared/src/services/platform-admin/ConfigBundleService.ts',
    'packages/frontend-host/src/features/platform-admin/Page.tsx',
  ]
  const result = validatePathCoverage(changedFiles, [fragment])
  assert.deepEqual(result.requirements, [
    'database migration notes and rollback',
    'API compatibility',
    'security impact',
    'configuration',
    'user impact',
    '@enterpriseglue/shared version',
    '@enterpriseglue/backend-host version',
    '@enterpriseglue/frontend-host version',
    '@enterpriseglue/enterprise-plugin-api version',
  ])
})

test('high-risk changes cannot use the release-note exemption', () => {
  assert.throws(
    () => validatePathCoverage(['packages/backend-host/src/modules/auth/routes/login.ts'], [], {
      exempt: true,
      exemptionReason: 'Release-note exemption: this would otherwise be long enough.',
    }),
    /cannot exempt high-risk changes/,
  )
})

test('breaking fragments require matching title and release label', () => {
  assert.throws(
    () => validatePrClassification([fragment], {
      title: 'feat(authz): add authorization',
      labels: ['release:security'],
    }),
    /title with !/,
  )
  assert.throws(
    () => validatePrClassification([fragment], {
      title: 'feat(authz)!: add authorization',
      labels: ['release:security'],
    }),
    /release:breaking/,
  )
  assert.doesNotThrow(() => validatePrClassification([fragment], {
    title: 'feat(authz)!: add authorization',
    labels: ['release:breaking'],
  }))
})

test('low-risk internal changes can be exempted only with a reason', () => {
  assert.throws(
    () => validatePathCoverage(['scripts/format-fixtures.mjs'], [], { exempt: true }),
    /requires "Release-note exemption/,
  )
  const result = validatePathCoverage(['scripts/format-fixtures.mjs'], [], {
    exempt: true,
    exemptionReason: 'Release-note exemption: formatting-only test fixture maintenance.',
  })
  assert.deepEqual(result.requirements, ['exempt'])
})

test('renderer produces audience, compatibility, package, rollback, and evidence sections', () => {
  const output = renderReleaseNotes([fragment], { version: '0.11.0', baseRef: 'v0.10.5' })
  assert.match(output, /# EnterpriseGlue v0\.11\.0 Release Notes/)
  assert.match(output, /\[!IMPORTANT\]/)
  assert.match(output, /## User and administrator impact/)
  assert.match(output, /## API and integration compatibility/)
  assert.match(output, /## Published packages/)
  assert.match(output, /@enterpriseglue\/enterprise-plugin-api/)
  assert.match(output, /## Documentation/)
  assert.match(output, /docs\/how-to\/auth-sso\.md/)
  assert.match(output, /## Rollback/)
  assert.match(output, /## Validation evidence/)
  assert.match(output, /Audiences: users, administrators, operators, developers, security/)
})

test('baseline detects a stale manifest and accepts a prepared release PR', () => {
  const changelog = '# Changelog\n\n## [0.11.0]\n\n## [0.10.5]\n'
  assert.throws(
    () => validateBaselineState({ manifestVersion: '0.10.4', latestTag: 'v0.10.5', changelog }),
    /behind latest tag/,
  )
  assert.deepEqual(
    validateBaselineState({
      manifestVersion: '0.11.0',
      latestTag: 'v0.10.5',
      changelog,
      allowPending: true,
    }),
    { manifestVersion: '0.11.0', latestTag: 'v0.10.5', pending: true },
  )
})

test('version recommendation follows pre-1.0 Release Please semantics', () => {
  assert.equal(recommendReleaseVersion([fragment], '0.10.5'), '0.11.0')
  const fix = structuredClone(fragment)
  fix.breaking = false
  fix.type = 'fix'
  fix.api.compatibility = 'additive'
  assert.equal(recommendReleaseVersion([fix], '0.10.5'), '0.10.6')
  assert.equal(recommendReleaseVersion([fragment], '1.4.2'), '2.0.0')
})

test('CI makes release-note validation and preview part of the aggregate gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(workflow, /^  release-notes:$/m)
  assert.match(workflow, /node scripts\/release-notes\.mjs baseline/)
  assert.match(workflow, /node scripts\/release-notes\.mjs validate --base-ref/)
  assert.match(workflow, /- name: Build release-note preview\n        if: always\(\)/)
  assert.match(workflow, /release-notes-preview-\$\{\{ github\.run_id \}\}/)
  assert.match(workflow, /"detect \/ detect"\|release-notes\|boundary-guards/)
})

test('normal and hotfix release workflows generate detailed notes through the same script', () => {
  const release = readFileSync(new URL('../.github/workflows/release-please.yml', import.meta.url), 'utf8')
  const hotfix = readFileSync(new URL('../.github/workflows/release-hotfix.yml', import.meta.url), 'utf8')
  for (const workflow of [release, hotfix]) {
    assert.match(workflow, /node scripts\/release-notes\.mjs baseline/)
    assert.match(workflow, /bash scripts\/prepare-release-notes-pr\.sh/)
  }
  assert.match(release, /gh release edit "v\$\{RELEASE_VERSION\}" --notes-file/)
  assert.match(hotfix, /merge-method: merge/)
})

test('pull request template requests the release fragment and an explicit exemption reason', () => {
  const template = readFileSync(new URL('../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8')
  assert.match(template, /\.release-notes\/<change-id>\.json/)
  assert.match(template, /Release-note exemption: <reason>/)
})
