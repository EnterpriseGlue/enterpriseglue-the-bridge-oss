#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FRAGMENT_DIR = '.release-notes'
const FRAGMENT_SCHEMA_VERSION = 1
const TYPES = new Set(['feature', 'fix', 'security', 'performance', 'deprecation', 'breaking', 'docs', 'internal'])
const AUDIENCES = new Set(['users', 'administrators', 'operators', 'developers', 'security'])
const API_COMPATIBILITY = new Set(['none', 'additive', 'deprecated', 'breaking'])
const PACKAGE_IMPACTS = new Set(['patch', 'minor', 'major'])
const REQUIRED_FIELDS = [
  'schemaVersion',
  'id',
  'type',
  'scope',
  'breaking',
  'audiences',
  'summary',
  'userImpact',
  'upgrade',
  'configuration',
  'api',
  'database',
  'security',
  'documentation',
  'knownLimitations',
  'rollback',
  'validation',
  'packages',
]

const PUBLISHED_PACKAGES = new Map([
  ['packages/shared/', '@enterpriseglue/shared'],
  ['packages/backend-host/', '@enterpriseglue/backend-host'],
  ['packages/frontend-host/', '@enterpriseglue/frontend-host'],
  ['packages/enterprise-plugin-api/', '@enterpriseglue/enterprise-plugin-api'],
])

function fail(message) {
  throw new Error(message)
}

function git(args, root = process.cwd()) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function parseArgs(argv) {
  const command = argv[0] || 'validate'
  const options = {}
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (!value.startsWith('--')) fail(`Unexpected argument: ${value}`)
    const key = value.slice(2)
    if (key === 'allow-pending') {
      options.allowPending = true
      continue
    }
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) fail(`Missing value for --${key}`)
    options[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next
    index += 1
  }
  return { command, options }
}

function parseVersion(version, context = 'version') {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) fail(`${context} must be an exact semantic version, received "${version}".`)
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  const a = parseVersion(left, 'left version')
  const b = parseVersion(right, 'right version')
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function versionImpact(previousVersion, newVersion) {
  const previous = parseVersion(previousVersion, 'previous package version')
  const next = parseVersion(newVersion, 'new package version')
  if (next[0] !== previous[0]) return next[0] > previous[0] ? 'major' : 'invalid'
  if (next[1] !== previous[1]) return next[1] > previous[1] ? 'minor' : 'invalid'
  if (next[2] !== previous[2]) return next[2] > previous[2] ? 'patch' : 'invalid'
  return 'invalid'
}

function assertObject(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context} must be an object.`)
}

function assertString(value, context, { min = 2, max = Number.POSITIVE_INFINITY } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    fail(`${context} must be a string between ${min} and ${Number.isFinite(max) ? max : 'unlimited'} characters.`)
  }
}

function assertStringList(value, context, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) fail(`${context} must be an array.`)
  if (nonEmpty && value.length === 0) fail(`${context} must contain at least one item.`)
  value.forEach((entry, index) => assertString(entry, `${context}[${index}]`))
}

export function validateFragment(fragment, source = 'release-note fragment') {
  assertObject(fragment, source)
  const allowedFields = new Set(['$schema', ...REQUIRED_FIELDS])
  const unknownFields = Object.keys(fragment).filter((key) => !allowedFields.has(key))
  if (unknownFields.length > 0) fail(`${source} contains unsupported field(s): ${unknownFields.join(', ')}.`)
  const missingFields = REQUIRED_FIELDS.filter((key) => !(key in fragment))
  if (missingFields.length > 0) fail(`${source} is missing required field(s): ${missingFields.join(', ')}.`)
  if (fragment.schemaVersion !== FRAGMENT_SCHEMA_VERSION) {
    fail(`${source}.schemaVersion must be ${FRAGMENT_SCHEMA_VERSION}.`)
  }
  assertString(fragment.id, `${source}.id`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fragment.id)) fail(`${source}.id must use lowercase kebab-case.`)
  if (!TYPES.has(fragment.type)) fail(`${source}.type is unsupported: ${fragment.type}.`)
  assertString(fragment.scope, `${source}.scope`)
  if (typeof fragment.breaking !== 'boolean') fail(`${source}.breaking must be boolean.`)
  assertStringList(fragment.audiences, `${source}.audiences`, { nonEmpty: true })
  if (new Set(fragment.audiences).size !== fragment.audiences.length) fail(`${source}.audiences must be unique.`)
  fragment.audiences.forEach((audience) => {
    if (!AUDIENCES.has(audience)) fail(`${source}.audiences contains unsupported audience: ${audience}.`)
  })
  assertString(fragment.summary, `${source}.summary`, { min: 20, max: 300 })
  assertStringList(fragment.userImpact, `${source}.userImpact`)
  assertObject(fragment.upgrade, `${source}.upgrade`)
  if (typeof fragment.upgrade.required !== 'boolean') fail(`${source}.upgrade.required must be boolean.`)
  assertStringList(fragment.upgrade.instructions, `${source}.upgrade.instructions`, {
    nonEmpty: fragment.upgrade.required,
  })
  assertStringList(fragment.configuration, `${source}.configuration`)
  assertObject(fragment.api, `${source}.api`)
  if (!API_COMPATIBILITY.has(fragment.api.compatibility)) {
    fail(`${source}.api.compatibility is unsupported: ${fragment.api.compatibility}.`)
  }
  assertStringList(fragment.api.changes, `${source}.api.changes`, {
    nonEmpty: fragment.api.compatibility !== 'none',
  })
  assertObject(fragment.database, `${source}.database`)
  assertStringList(fragment.database.migrations, `${source}.database.migrations`)
  if (typeof fragment.database.rollbackSupported !== 'boolean') {
    fail(`${source}.database.rollbackSupported must be boolean.`)
  }
  assertStringList(fragment.database.notes, `${source}.database.notes`)
  assertStringList(fragment.security, `${source}.security`)
  assertStringList(fragment.documentation, `${source}.documentation`, { nonEmpty: true })
  assertStringList(fragment.knownLimitations, `${source}.knownLimitations`)
  assertStringList(fragment.rollback, `${source}.rollback`)
  assertStringList(fragment.validation, `${source}.validation`, { nonEmpty: true })
  if (!Array.isArray(fragment.packages)) fail(`${source}.packages must be an array.`)
  const packageNames = new Set()
  fragment.packages.forEach((entry, index) => {
    const context = `${source}.packages[${index}]`
    assertObject(entry, context)
    const keys = Object.keys(entry)
    const required = ['name', 'previousVersion', 'newVersion', 'impact']
    const unknown = keys.filter((key) => !required.includes(key))
    const missing = required.filter((key) => !(key in entry))
    if (unknown.length > 0 || missing.length > 0) {
      fail(`${context} must contain exactly name, previousVersion, newVersion, and impact.`)
    }
    assertString(entry.name, `${context}.name`)
    if (packageNames.has(entry.name)) fail(`${source}.packages contains duplicate package ${entry.name}.`)
    packageNames.add(entry.name)
    parseVersion(entry.previousVersion, `${context}.previousVersion`)
    parseVersion(entry.newVersion, `${context}.newVersion`)
    if (!PACKAGE_IMPACTS.has(entry.impact)) fail(`${context}.impact is unsupported: ${entry.impact}.`)
    const actualImpact = versionImpact(entry.previousVersion, entry.newVersion)
    if (actualImpact !== entry.impact) {
      fail(`${context} declares ${entry.impact}, but ${entry.previousVersion} -> ${entry.newVersion} is ${actualImpact}.`)
    }
  })
  if (fragment.api.compatibility === 'breaking' && !fragment.breaking) {
    fail(`${source} declares a breaking API change but breaking is false.`)
  }
  if (fragment.breaking && !fragment.upgrade.required) {
    fail(`${source} is breaking and must provide required upgrade instructions.`)
  }
  return fragment
}

export function validatePathCoverage(changedFiles, fragments, { exempt = false, exemptionReason = '' } = {}) {
  const relevant = changedFiles.filter(isReleaseRelevantPath)
  const highRisk = relevant.filter(isHighRiskPath)
  if (relevant.length === 0) return { relevant, highRisk, requirements: [] }
  if (fragments.length === 0) {
    if (!exempt) fail('Release-impacting changes require a changed .release-notes/*.json fragment.')
    if (highRisk.length > 0) {
      fail(`release-note:none cannot exempt high-risk changes: ${highRisk.slice(0, 8).join(', ')}.`)
    }
    const match = String(exemptionReason).match(/release-note exemption\s*:\s*([^\n]+)/i)
    if (!match || match[1].trim().length < 10) {
      fail('release-note:none requires "Release-note exemption: <reason>" in the PR body.')
    }
    return { relevant, highRisk, requirements: ['exempt'] }
  }

  const requirements = []
  const any = (predicate) => fragments.some(predicate)
  const pathsMatch = (pattern) => relevant.some((file) => pattern.test(file))

  if (pathsMatch(/(^|\/)migrations?\//i)) {
    requirements.push('database migration notes and rollback')
    if (!any((fragment) => fragment.database.migrations.length > 0 && fragment.rollback.length > 0)) {
      fail('Migration changes require database.migrations and rollback release notes.')
    }
  }
  if (pathsMatch(/openapi|enterprise-plugin-api\/src|schemas?\/.*(?:api|config)/i)) {
    requirements.push('API compatibility')
    if (!any((fragment) => fragment.api.compatibility !== 'none' && fragment.api.changes.length > 0)) {
      fail('Public API or schema changes require api.compatibility and api.changes release notes.')
    }
  }
  if (pathsMatch(/(?:^|\/)(?:auth|authz|identity|sso)(?:\/|[-_.])/i)) {
    requirements.push('security impact')
    if (!any((fragment) => fragment.security.length > 0)) {
      fail('Authentication or authorization changes require security release notes.')
    }
  }
  if (pathsMatch(/\.env\.example$|config[-_.]?bundle|configuration|infra\/docker\/env/i)) {
    requirements.push('configuration')
    if (!any((fragment) => fragment.configuration.length > 0)) {
      fail('Configuration changes require configuration release notes.')
    }
  }
  if (pathsMatch(/^(?:frontend|packages\/frontend-host)\/src\//)) {
    requirements.push('user impact')
    if (!any((fragment) => fragment.userImpact.length > 0)) {
      fail('User-interface changes require userImpact release notes.')
    }
  }

  const packageRecords = new Set(fragments.flatMap((fragment) => fragment.packages.map((entry) => entry.name)))
  for (const [prefix, packageName] of PUBLISHED_PACKAGES) {
    const packageChanged = relevant.some((file) => file.startsWith(prefix) && !/\/(?:__tests__|test|docs)\//.test(file))
    if (packageChanged) {
      requirements.push(`${packageName} version`)
      if (!packageRecords.has(packageName)) fail(`Changes to ${prefix} require a packages entry for ${packageName}.`)
    }
  }

  return { relevant, highRisk, requirements: [...new Set(requirements)] }
}

export function validatePrClassification(fragments, { title = '', labels = [] } = {}) {
  if (!title || fragments.length === 0) return
  const breaking = fragments.some((fragment) => fragment.breaking || fragment.type === 'breaking')
  const titleBreaking = /^[a-z]+(?:\([a-z0-9._/-]+\))?!:/i.test(title.trim())
  const releaseLabels = labels.filter((label) => label.startsWith('release:'))
  if (breaking) {
    if (!titleBreaking) fail('Breaking release-note fragments require a conventional PR title with ! before the colon.')
    if (!releaseLabels.includes('release:breaking')) fail('Breaking release-note fragments require the release:breaking label.')
    return
  }
  if (titleBreaking || releaseLabels.includes('release:breaking')) {
    fail('The PR declares a breaking release, but no changed release-note fragment has breaking=true.')
  }
}

function isReleaseRelevantPath(file) {
  return !(
    file.startsWith(`${FRAGMENT_DIR}/`) ||
    file.startsWith('docs/') ||
    file.startsWith('test/') ||
    file.includes('/__tests__/') ||
    file.endsWith('.test.mjs') ||
    file.endsWith('.test.ts') ||
    file.endsWith('.test.tsx') ||
    file === 'CHANGELOG.md' ||
    file === '.github/.release-please-manifest.json' ||
    file === 'pnpm-lock.yaml' ||
    file.endsWith('.md') ||
    file === 'third_party_licenses.json'
  )
}

function isHighRiskPath(file) {
  return /(^|\/)migrations?\/|openapi|enterprise-plugin-api\/src|(?:^|\/)(?:auth|authz|identity|sso)(?:\/|[-_.])/i.test(file)
}

function listFragmentPaths(root) {
  const directory = join(root, FRAGMENT_DIR)
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json') && name !== 'schema.json')
    .map((name) => `${FRAGMENT_DIR}/${name}`)
    .sort()
}

function changedPaths(root, baseRef) {
  if (!baseRef) return []
  const output = git(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`], root)
  const untracked = git(['ls-files', '--others', '--exclude-standard'], root)
  return unique([
    ...(output ? output.split('\n').filter(Boolean) : []),
    ...(untracked ? untracked.split('\n').filter(Boolean) : []),
  ])
}

function loadFragment(root, fragmentPath) {
  let value
  try {
    value = JSON.parse(readFileSync(join(root, fragmentPath), 'utf8'))
  } catch (error) {
    fail(`${fragmentPath} is not valid JSON: ${error.message}`)
  }
  return { path: fragmentPath, value: validateFragment(value, fragmentPath) }
}

function resolveDefaultBase(root) {
  const githubBase = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : ''
  if (githubBase) {
    try {
      git(['rev-parse', '--verify', githubBase], root)
      return githubBase
    } catch {
      // Fall through to the latest stable tag.
    }
  }
  return latestStableTag(root)
}

export function latestStableTag(root = process.cwd()) {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'], root)
    .split('\n')
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  if (tags.length === 0) fail('No stable vX.Y.Z tag exists; pass --base-ref explicitly.')
  return tags[0]
}

function releaseSelection(root, baseRef) {
  const allPaths = listFragmentPaths(root)
  const changed = new Set(changedPaths(root, baseRef).filter((file) => file.startsWith(`${FRAGMENT_DIR}/`)))
  const selectedPaths = allPaths.filter((file) => changed.has(file))
  const all = allPaths.map((file) => loadFragment(root, file))
  const ids = new Map()
  for (const entry of all) {
    const expectedId = entry.path.slice(`${FRAGMENT_DIR}/`.length, -'.json'.length)
    if (entry.value.id !== expectedId) {
      fail(`${entry.path} must use an id matching its filename (${expectedId}).`)
    }
    if (ids.has(entry.value.id)) fail(`Duplicate release-note id ${entry.value.id} in ${ids.get(entry.value.id)} and ${entry.path}.`)
    ids.set(entry.value.id, entry.path)
  }
  return {
    all,
    selected: selectedPaths.map((file) => loadFragment(root, file)),
    changedFiles: changedPaths(root, baseRef),
  }
}

function unique(items) {
  return [...new Set(items)]
}

function section(title, items) {
  const values = unique(items.filter(Boolean))
  if (values.length === 0) return ''
  return `## ${title}\n\n${values.map((item) => `- ${item}`).join('\n')}\n\n`
}

function consolidatePackages(entries) {
  const packages = new Map()
  for (const entry of entries) {
    const existing = packages.get(entry.name)
    if (!existing) {
      packages.set(entry.name, { ...entry })
      continue
    }
    if (compareVersions(entry.previousVersion, existing.previousVersion) < 0) {
      existing.previousVersion = entry.previousVersion
    }
    if (compareVersions(entry.newVersion, existing.newVersion) > 0) {
      existing.newVersion = entry.newVersion
    }
    existing.impact = versionImpact(existing.previousVersion, existing.newVersion)
  }
  return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function recommendReleaseVersion(fragments, baseVersion, { bumpMinorPreMajor = true } = {}) {
  if (fragments.length === 0) fail('Cannot recommend a release version without release-note fragments.')
  const [major, minor, patch] = parseVersion(baseVersion, 'base release version')
  const hasBreaking = fragments.some((fragment) => fragment.breaking || fragment.type === 'breaking')
  const hasFeature = fragments.some((fragment) => fragment.type === 'feature' || fragment.type === 'deprecation')
  if (hasBreaking) {
    if (major === 0 && bumpMinorPreMajor) return `0.${minor + 1}.0`
    return `${major + 1}.0.0`
  }
  if (hasFeature) return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export function renderReleaseNotes(fragments, { version = 'next', baseRef = '' } = {}) {
  if (fragments.length === 0) {
    return `# EnterpriseGlue ${version === 'next' ? 'Release Notes Preview' : `v${version} Release Notes`}\n\nNo release-note fragments changed since \`${baseRef || 'the selected baseline'}\`.\n`
  }
  const releaseTitle = version === 'next' ? 'Release Notes Preview' : `v${version} Release Notes`
  const breaking = fragments.some((fragment) => fragment.breaking)
  let output = '<!-- Generated by scripts/release-notes.mjs. Update source fragments instead of editing this file. -->\n\n'
  output += `# EnterpriseGlue ${releaseTitle}\n\n`
  if (version === 'next') output += 'Status: Preview\n\n'
  if (baseRef) output += `Generated from release-note fragments changed since \`${baseRef}\`.\n\n`
  if (breaking) {
    output += '> [!IMPORTANT]\n> This release contains compatibility changes that require the upgrade guidance below.\n\n'
  }
  output += section('Highlights', fragments.map((fragment) => `**${fragment.scope}:** ${fragment.summary}`))
  output += section('User and administrator impact', fragments.flatMap((fragment) => fragment.userImpact))

  const upgradeItems = fragments.flatMap((fragment) => fragment.upgrade.instructions)
  output += section('Upgrade and compatibility', upgradeItems)
  output += section('API and integration compatibility', fragments.flatMap((fragment) => fragment.api.changes))
  output += section('Configuration', fragments.flatMap((fragment) => fragment.configuration))

  const databaseItems = fragments.flatMap((fragment) => [
    ...fragment.database.migrations.map((migration) => `Migration: ${migration}.`),
    ...fragment.database.notes,
    `Database rollback supported: ${fragment.database.rollbackSupported ? 'yes' : 'no'}.`,
  ])
  output += section('Database migrations', databaseItems)
  output += section('Security', fragments.flatMap((fragment) => fragment.security))
  output += section('Documentation', fragments.flatMap((fragment) => fragment.documentation))

  const packages = consolidatePackages(fragments.flatMap((fragment) => fragment.packages))
  if (packages.length > 0) {
    output += '## Published packages\n\n| Package | Previous | New | Impact |\n|---|---:|---:|---|\n'
    output += packages
      .map((entry) => `| \`${entry.name}\` | \`${entry.previousVersion}\` | \`${entry.newVersion}\` | ${entry.impact} |`)
      .join('\n')
    output += '\n\n'
  }

  output += section('Known limitations', fragments.flatMap((fragment) => fragment.knownLimitations))
  output += section('Rollback', fragments.flatMap((fragment) => fragment.rollback))
  output += section('Validation evidence', fragments.flatMap((fragment) => fragment.validation))
  output += '## Release metadata\n\n'
  output += `- Release-note fragments: ${fragments.map((fragment) => `\`${fragment.id}\``).join(', ')}\n`
  output += `- Audiences: ${unique(fragments.flatMap((fragment) => fragment.audiences)).join(', ')}\n`
  output += `- Compatibility: ${breaking ? 'breaking upgrade guidance required' : 'backward-compatible'}\n`
  return output
}

export function validateBaselineState({ manifestVersion, latestTag, changelog, allowPending = false }) {
  const latestVersion = latestTag.replace(/^v/, '')
  const latestHeading = new RegExp(`^## \\[${latestVersion.replace(/\./g, '\\.') }\\]`, 'm')
  if (!latestHeading.test(changelog)) fail(`CHANGELOG.md does not contain the latest tag ${latestTag}.`)
  const comparison = compareVersions(manifestVersion, latestVersion)
  if (comparison < 0) fail(`Release Please manifest ${manifestVersion} is behind latest tag ${latestTag}.`)
  if (comparison > 0) {
    if (!allowPending) fail(`Release Please manifest ${manifestVersion} is ahead of latest tag ${latestTag} outside a release PR.`)
    const pendingHeading = new RegExp(`^## \\[${manifestVersion.replace(/\./g, '\\.') }\\]`, 'm')
    if (!pendingHeading.test(changelog)) fail(`Pending release ${manifestVersion} is missing from CHANGELOG.md.`)
  }
  return { manifestVersion, latestTag, pending: comparison > 0 }
}

function writeOutput(outputPath, contents, root) {
  if (!outputPath) {
    process.stdout.write(contents)
    return
  }
  const absolute = resolve(root, outputPath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents)
  console.log(`[release-notes] wrote ${relative(root, absolute)}`)
}

function runValidate(root, options) {
  const baseRef = options.baseRef || resolveDefaultBase(root)
  const selection = releaseSelection(root, baseRef)
  const changedFragmentPaths = new Set(selection.selected.map((entry) => entry.path))
  const fragments = selection.all.filter((entry) => changedFragmentPaths.has(entry.path)).map((entry) => entry.value)
  const exempt = String(process.env.RELEASE_NOTE_EXEMPT || '').toLowerCase() === 'true'
  const coverage = validatePathCoverage(selection.changedFiles, fragments, {
    exempt,
    exemptionReason: process.env.RELEASE_NOTE_EXEMPT_REASON || '',
  })
  const labels = String(process.env.RELEASE_PR_LABELS || '').split(',').map((label) => label.trim()).filter(Boolean)
  validatePrClassification(fragments, {
    title: process.env.RELEASE_PR_TITLE || '',
    labels,
  })
  console.log(`[release-notes] validated ${selection.all.length} stored fragment(s).`)
  console.log(`[release-notes] ${fragments.length} fragment(s) cover ${coverage.relevant.length} release-impacting file(s) since ${baseRef}.`)
  if (coverage.requirements.length > 0) {
    console.log(`[release-notes] enforced: ${coverage.requirements.join(', ')}.`)
  }
}

function runPreviewOrRender(root, options, command) {
  const baseRef = options.baseRef || resolveDefaultBase(root)
  const selection = releaseSelection(root, baseRef)
  const fragments = selection.selected.map((entry) => entry.value)
  const version = command === 'preview' ? 'next' : options.version
  if (command === 'render' && !version) fail('render requires --version X.Y.Z.')
  if (version !== 'next') parseVersion(version, 'release version')
  writeOutput(options.output, renderReleaseNotes(fragments, { version, baseRef }), root)
}

function runRecommendOrAssert(root, options, command) {
  const baseRef = options.baseRef || resolveDefaultBase(root)
  const selection = releaseSelection(root, baseRef)
  const fragments = selection.selected.map((entry) => entry.value)
  if (command === 'recommend' && fragments.length === 0) {
    console.log(`[release-notes] no fragment-derived release version since ${baseRef}.`)
    return
  }
  const baseVersion = String(baseRef).replace(/^v/, '')
  parseVersion(baseVersion, 'base-ref version')
  const config = JSON.parse(readFileSync(join(root, '.github/release-please-config.json'), 'utf8'))
  const expected = recommendReleaseVersion(fragments, baseVersion, {
    bumpMinorPreMajor: config['bump-minor-pre-major'] !== false,
  })
  if (command === 'assert-version') {
    if (!options.version) fail('assert-version requires --version X.Y.Z.')
    parseVersion(options.version, 'proposed release version')
    if (options.version !== expected) {
      fail(`Proposed release ${options.version} does not match fragment-derived version ${expected} from ${baseRef}.`)
    }
  }
  console.log(`[release-notes] expected release version: ${expected} (base ${baseRef}).`)
}

function runBaseline(root, options) {
  const manifest = JSON.parse(readFileSync(join(root, '.github/.release-please-manifest.json'), 'utf8'))
  const manifestVersion = manifest['.']
  parseVersion(manifestVersion, 'Release Please manifest version')
  const latestTag = latestStableTag(root)
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const releaseBranch = String(process.env.GITHUB_HEAD_REF || '').startsWith('release-please--branches--')
  const result = validateBaselineState({
    manifestVersion,
    latestTag,
    changelog,
    allowPending: Boolean(options.allowPending || releaseBranch),
  })
  console.log(`[release-notes] baseline valid: manifest=${result.manifestVersion}, latest=${result.latestTag}, pending=${result.pending}.`)
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { command, options } = parseArgs(argv)
  if (command === 'validate') return runValidate(root, options)
  if (command === 'preview' || command === 'render') return runPreviewOrRender(root, options, command)
  if (command === 'recommend' || command === 'assert-version') return runRecommendOrAssert(root, options, command)
  if (command === 'baseline') return runBaseline(root, options)
  fail(`Unknown command: ${command}. Expected validate, preview, render, recommend, assert-version, or baseline.`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    main()
  } catch (error) {
    console.error(`[release-notes] ${error.message}`)
    process.exitCode = 1
  }
}
