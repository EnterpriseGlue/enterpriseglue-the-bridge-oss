#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function exec(command, args, cwd, { optional = false } = {}) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (optional) return ''
    throw new Error(`${command} ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`)
  }
}

export function classifyChangedFiles(files) {
  const matches = (pattern) => files.some((file) => pattern.test(file))
  return {
    releaseFragments: files.filter((file) => /^\.release-notes\/[^/]+\.json$/.test(file)),
    api: matches(/openapi|enterprise-plugin-api|packages\/shared\/src\/schemas/i),
    auth: matches(/(?:^|\/)(?:auth|authz|identity|sso)(?:\/|[-_.])/i),
    database: matches(/(?:^|\/)(?:migrations?|entities|persistence)(?:\/|[-_.])/i),
    docs: matches(/^(?:docs\/|README\.md|CONTRIBUTING\.md)/),
    ui: matches(/^(?:frontend|packages\/frontend-host)\/src\//),
    config: matches(/config[-_.]?bundle|\.env\.example$|configuration/i),
    packages: matches(/^packages\/(?:shared|backend-host|frontend-host|enterprise-plugin-api)\//),
  }
}

function parseArgs(argv) {
  const options = { baseRef: 'origin/main', format: 'markdown' }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!['--base-ref', '--format', '--output'].includes(key)) throw new Error(`Unknown option: ${key}`)
    const value = argv[index + 1]
    if (!value) throw new Error(`Missing value for ${key}`)
    options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
    index += 1
  }
  if (!['markdown', 'json'].includes(options.format)) throw new Error('--format must be markdown or json')
  return options
}

export function collectReadiness(root, baseRef) {
  const branch = exec('git', ['branch', '--show-current'], root)
  const head = exec('git', ['rev-parse', 'HEAD'], root)
  exec('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], root)
  const files = [...new Set([
    exec('git', ['diff', '--name-only', `${baseRef}...HEAD`], root),
    exec('git', ['diff', '--name-only'], root),
    exec('git', ['diff', '--cached', '--name-only'], root),
    exec('git', ['ls-files', '--others', '--exclude-standard'], root),
  ].flatMap((output) => output.split('\n').map((file) => file.trim()).filter(Boolean)))].sort()
  const dirty = Boolean(exec('git', ['status', '--short'], root))
  const surfaces = classifyChangedFiles(files)
  const prRaw = exec('gh', [
    'pr', 'view', '--json',
    'number,url,isDraft,title,labels,mergeStateStatus,statusCheckRollup',
  ], root, { optional: true })
  const pr = prRaw ? JSON.parse(prRaw) : null
  const checks = pr?.statusCheckRollup || []
  const failedChecks = checks.filter((check) =>
    ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(check.conclusion))
  const pendingChecks = checks.filter((check) => check.status !== 'COMPLETED')
  const blockers = []
  const warnings = []
  const releaseRelevant = files.some((file) =>
    !/^(?:\.release-notes\/|docs\/|test\/|.*(?:\.test\.[cm]?[jt]sx?|\.md)$)/.test(file))
  if (releaseRelevant && surfaces.releaseFragments.length === 0) blockers.push('No changed release-note fragment was detected.')
  if (failedChecks.length > 0) blockers.push(`${failedChecks.length} GitHub check(s) are failing.`)
  if (dirty) warnings.push('The worktree has uncommitted changes.')
  if (!pr) warnings.push('No pull request metadata was available from gh.')
  if (pendingChecks.length > 0) warnings.push(`${pendingChecks.length} GitHub check(s) are still pending.`)
  if ((surfaces.api || surfaces.config || surfaces.database) && !surfaces.docs) {
    warnings.push('Contract, configuration, or persistence paths changed without a documentation path in the diff.')
  }
  return { baseRef, branch, head, dirty, files, surfaces, pr, failedChecks, pendingChecks, blockers, warnings }
}

export function renderMarkdown(report) {
  const status = report.blockers.length > 0 ? 'Blocked' : report.warnings.length > 0 ? 'Conditional' : 'Ready'
  const rows = Object.entries(report.surfaces)
    .filter(([key]) => key !== 'releaseFragments')
    .map(([key, value]) => `| ${key} | ${value ? 'yes' : 'no'} |`).join('\n')
  const list = (items) => items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None'
  return `# EnterpriseGlue PR readiness\n\nStatus: **${status}**\n\n` +
    `- Branch: \`${report.branch}\`\n- Head: \`${report.head}\`\n- Base: \`${report.baseRef}\`\n` +
    `- Pull request: ${report.pr ? `[#${report.pr.number}](${report.pr.url})${report.pr.isDraft ? ' (draft)' : ''}` : 'not available'}\n` +
    `- Changed files: ${report.files.length}\n- Release fragments: ${report.surfaces.releaseFragments.length}\n\n` +
    `## Selected surfaces\n\n| Surface | Changed |\n|---|---|\n${rows}\n\n` +
    `## Blockers\n\n${list(report.blockers)}\n\n## Warnings\n\n${list(report.warnings)}\n`
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const root = exec('git', ['rev-parse', '--show-toplevel'], process.cwd())
  const report = collectReadiness(root, options.baseRef)
  const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report)
  if (options.output) {
    const target = resolve(root, options.output)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, output)
    console.log(`[pr-readiness] wrote ${target}`)
  } else process.stdout.write(output)
  if (report.blockers.length > 0) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
