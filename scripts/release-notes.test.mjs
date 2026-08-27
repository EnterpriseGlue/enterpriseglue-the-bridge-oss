import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  changedPaths,
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

test('initial package publication is explicit and cannot masquerade as an upgrade', () => {
  const candidate = structuredClone(fragment)
  candidate.packages = [{
    name: '@enterpriseglue/plugin-sdk',
    previousVersion: null,
    newVersion: '0.2.0',
    impact: 'initial',
  }]
  assert.doesNotThrow(() => validateFragment(candidate))
  candidate.packages[0].impact = 'minor'
  assert.throws(() => validateFragment(candidate), /not previously published.*is initial/)
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

test('package-local image Dockerfiles do not require npm package version entries', () => {
  const result = validatePathCoverage([
    'packages/plugin-installer/Dockerfile',
    'packages/plugin-manager/Dockerfile.release',
  ], [fragment])
  assert.deepEqual(result.requirements, [])

  assert.throws(
    () => validatePathCoverage(['packages/plugin-installer/src/index.ts'], [fragment]),
    /Changes to packages\/plugin-installer\/ require a packages entry for @enterpriseglue\/plugin-installer/,
  )
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
  assert.throws(
    () => validatePrClassification([fragment], {
      title: 'chore(main): release 0.11.0',
      labels: ['release:breaking'],
    }),
    /title with !/,
  )
  assert.doesNotThrow(() => validatePrClassification([fragment], {
    title: 'chore(main): release 0.11.0',
    labels: ['release:breaking'],
    isReleasePlease: true,
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

test('local release validation includes committed, staged, modified, and untracked paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'enterpriseglue-release-paths-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git('init')
  git('config', 'user.email', 'test@enterpriseglue.local')
  git('config', 'user.name', 'EnterpriseGlue Test')
  writeFileSync(join(root, 'tracked.txt'), 'initial\n')
  writeFileSync(join(root, 'staged.txt'), 'initial\n')
  git('add', '.')
  git('commit', '-m', 'initial')
  writeFileSync(join(root, 'tracked.txt'), 'modified\n')
  writeFileSync(join(root, 'staged.txt'), 'staged\n')
  git('add', 'staged.txt')
  writeFileSync(join(root, 'untracked.txt'), 'untracked\n')
  assert.deepEqual(changedPaths(root, 'HEAD').sort(), ['staged.txt', 'tracked.txt', 'untracked.txt'])
})

test('renderer produces audience, compatibility, package, rollback, and evidence sections', () => {
  const output = renderReleaseNotes([fragment], { version: '0.11.0', baseRef: 'v0.10.5' })
  assert.match(output, /^---\ndoc_class: technical\naudience: \[operator, developer, maintainer\]\npublication: github\nlifecycle: release\n---\n/)
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

test('empty generated release documents retain repository publication metadata', () => {
  const output = renderReleaseNotes([], { version: '0.11.0', baseRef: 'v0.10.5' })
  assert.match(output, /^---\ndoc_class: technical\n/)
  assert.match(output, /publication: github/)
  assert.match(output, /lifecycle: release/)
  assert.match(output, /No release-note fragments changed since `v0\.10\.5`\./)
})

test('renderer reports one conservative database rollback verdict across fragments', () => {
  const rollbackSafe = structuredClone(fragment)
  rollbackSafe.id = 'image-only-fix'
  rollbackSafe.breaking = false
  rollbackSafe.type = 'security'
  rollbackSafe.api.compatibility = 'none'
  rollbackSafe.api.changes = []
  rollbackSafe.database.rollbackSupported = true
  rollbackSafe.packages = []

  const output = renderReleaseNotes([rollbackSafe, fragment], { version: '0.11.0', baseRef: 'v0.10.7' })
  assert.equal((output.match(/Database rollback supported for the combined release:/g) || []).length, 1)
  assert.match(output, /Database rollback supported for the combined release: no\./)
  assert.doesNotMatch(output, /Database rollback supported: yes\./)
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

test('the reusable preflight fetches fresh PR metadata and validates release notes', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release-notes-preflight-reusable.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /^  workflow_call:$/m)
  assert.match(workflow, /github\.rest\.pulls\.get/)
  assert.match(workflow, /inputs\.pull_number > 0 \|\|\n\s+github\.event_name == 'merge_group' \|\|/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/)
  assert.match(workflow, /github\.rest\.pulls\.list/)
  assert.match(workflow, /headRef\.match\(\/\(\?:\^\|\\\/\)pr-\(\\d\+\)-\//)
  assert.match(workflow, /core\.setOutput\('head_ref', pullRequest\.head\?\.ref/)
  assert.match(workflow, /RELEASE_NOTE_EXEMPT: \$\{\{ steps\.pull_request\.outputs\.exempt/)
  assert.match(workflow, /RELEASE_PR_LABELS: \$\{\{ steps\.pull_request\.outputs\.labels/)
  assert.match(workflow, /RELEASE_PR_TITLE: \$\{\{ steps\.pull_request\.outputs\.title/)
  assert.match(workflow, /RELEASE_PR_HEAD_REF: \$\{\{ steps\.pull_request\.outputs\.head_ref/)
  assert.match(workflow, /- name: Run release-note preflight/)
  assert.match(workflow, /node scripts\/run-release-notes-preflight\.mjs/)
  assert.match(workflow, /--base-ref "\$\{\{ steps\.release_base\.outputs\.base_ref \}\}"/)
  assert.match(workflow, /preflight_args\+\=\(--allow-pending\)/)
  assert.match(workflow, /base_manifest_version=/)
  assert.match(workflow, /- name: Upload release-note preview\n        if: always\(\)/)
  assert.match(workflow, /release-notes-preview-\$\{\{ github\.run_id \}\}/)
})

test('CI blocks change detection and its aggregate gate on release-note preflight', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(workflow, /^  release-notes-preflight:$/m)
  assert.match(workflow, /uses: \.\/\.github\/workflows\/release-notes-preflight-reusable\.yml/)
  assert.match(workflow, /^  detect:\n    needs: release-notes-preflight$/m)
  assert.match(workflow, /^  ci-complete:\n    needs:\n(?:      - [a-z0-9-]+\n)+/m)
  assert.match(workflow, /      - release-notes-preflight/)
  assert.match(workflow, /      - plugin-platform/)
  assert.match(workflow, /      - release-readiness/)
  assert.match(workflow, /node scripts\/check-ci-aggregate-contract\.mjs/)
  assert.match(workflow, /CI_NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/)
  assert.match(workflow, /node scripts\/evaluate-ci-needs\.mjs/)
})

test('expensive pull-request workflows cannot start before release-note preflight', () => {
  const dependencyRoots = new Map([
    ['authz-pr.yml', ['adapter-backstop-changes', 'authorization']],
    ['identity-protocol-rehearsal.yml', ['protocol-rehearsal']],
    ['engine-tenancy-database.yml', ['database-matrix']],
    ['access-governance-deployment-evidence.yml', ['contract']],
    ['codeql.yml', ['analyze']],
    ['third-party-notices.yml', ['verify-third-party-notices']],
  ])

  for (const [filename, roots] of dependencyRoots) {
    const workflow = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8')
    assert.match(workflow, /^  release-notes-preflight:$/m, `${filename} must call the preflight`)
    assert.match(
      workflow,
      /uses: \.\/\.github\/workflows\/release-notes-preflight-reusable\.yml/,
      `${filename} must use the shared implementation`,
    )
    for (const root of roots) {
      const start = workflow.indexOf(`  ${root}:\n`)
      assert.notEqual(start, -1, `${filename} is missing ${root}`)
      const next = workflow.slice(start + root.length + 3).search(/^  [a-z0-9-]+:\n/m)
      const block = next === -1 ? workflow.slice(start) : workflow.slice(start, start + root.length + 3 + next)
      assert.match(block, /^    needs: release-notes-preflight$/m, `${filename}:${root} must wait for preflight`)
    }
  }
})

test('normal and hotfix release workflows generate detailed notes through the same script', () => {
  const release = readFileSync(new URL('../.github/workflows/release-please.yml', import.meta.url), 'utf8')
  const hotfix = readFileSync(new URL('../.github/workflows/release-hotfix.yml', import.meta.url), 'utf8')
  const prepare = readFileSync(new URL('./prepare-release-notes-pr.sh', import.meta.url), 'utf8')
  for (const workflow of [release, hotfix]) {
    assert.match(workflow, /node scripts\/release-notes\.mjs baseline/)
    assert.match(workflow, /bash scripts\/prepare-release-notes-pr\.sh/)
    assert.match(
      workflow,
      /uses: actions\/checkout@[^\n]+\n\s+with:\n\s+fetch-depth: 0\n\s+token: \$\{\{ secrets\.RELEASE_PLEASE_TOKEN != '' && secrets\.RELEASE_PLEASE_TOKEN \|\| github\.token \}\}/,
      'release workflows must persist the trusted release token for release-note branch pushes',
    )
  }
  assert.match(
    prepare,
    /"\+refs\/heads\/\$\{RELEASE_PR_HEAD_REF\}:refs\/remotes\/origin\/\$\{RELEASE_PR_HEAD_REF\}"/,
    'release-note preparation must refresh the validated moving Release Please ref',
  )
  assert.match(prepare, /enterpriseglue-detailed-release-notes/)
  assert.match(prepare, /issues\/\$\{RELEASE_PR_NUMBER\}\/comments/)
  assert.doesNotMatch(
    prepare,
    /repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{RELEASE_PR_NUMBER\}/,
    'detailed notes must not replace Release Please machine-readable PR metadata',
  )
  assert.match(release, /gh release edit "v\$\{RELEASE_VERSION\}" --notes-file/)
  assert.match(release, /baseline --allow-pending/)
  assert.equal((release.match(/\^chore\\\(main\\\)!\?: release/g) || []).length, 2)
  assert.match(hotfix, /merge-method: merge/)
})

test('pull request template requests the release fragment and an explicit exemption reason', () => {
  const template = readFileSync(new URL('../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8')
  assert.match(template, /\.release-notes\/<change-id>\.json/)
  assert.match(template, /Release-note exemption: <reason>/)
})
