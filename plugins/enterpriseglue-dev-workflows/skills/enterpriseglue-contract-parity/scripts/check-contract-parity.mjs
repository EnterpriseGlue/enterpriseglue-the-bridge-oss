#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function analyzeParity(files) {
  const any = (pattern) => files.some((file) => pattern.test(file))
  const surfaces = {
    api: any(/openapi|enterprise-plugin-api|packages\/shared\/src\/schemas/i),
    config: any(/config[-_.]?bundle|configuration/i) || any(/(?:^|\/)\.env\.example$/i),
    docs: any(/^(?:docs\/|README\.md|CONTRIBUTING\.md)/),
    persistence: any(/(?:migrations?|entities|persistence|repositories?)\//i),
    tests: any(/(?:^test\/|\/__tests__\/|\.test\.[cm]?[jt]sx?$)/),
    ui: any(/^(?:frontend|packages\/frontend-host)\/src\//),
    examples: any(/(?:^|\/)(?:examples?|fixtures?)\//i),
  }
  const findings = []
  if ((surfaces.api || surfaces.config || surfaces.persistence || surfaces.ui) && !surfaces.docs) {
    findings.push({ severity: 'warning', code: 'missing-docs', message: 'Contract-facing changes have no documentation path in the diff.' })
  }
  if ((surfaces.api || surfaces.config || surfaces.persistence || surfaces.ui) && !surfaces.tests) {
    findings.push({ severity: 'error', code: 'missing-tests', message: 'Contract-facing changes have no test path in the diff.' })
  }
  if (surfaces.config && !surfaces.api) {
    findings.push({ severity: 'warning', code: 'config-without-api', message: 'Configuration changed without an OpenAPI or shared-schema path; verify headless parity.' })
  }
  if (surfaces.ui && !surfaces.config && !surfaces.api) {
    findings.push({ severity: 'warning', code: 'ui-only', message: 'UI changed without a configuration or API contract path; verify it is presentation-only.' })
  }
  if (surfaces.api && !surfaces.examples) {
    findings.push({ severity: 'warning', code: 'missing-example', message: 'Public contract changed without an example or fixture path.' })
  }
  return { surfaces, findings }
}

function changedFiles(baseRef) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  execFileSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { cwd: root, stdio: 'ignore' })
  const commands = [
    ['diff', '--name-only', `${baseRef}...HEAD`],
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]
  return [...new Set(commands.flatMap((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\n').map((file) => file.trim()).filter(Boolean)))].sort()
}

export function main(argv = process.argv.slice(2)) {
  let baseRef = 'origin/main'; let strict = false; let json = false
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--strict') strict = true
    else if (argv[index] === '--json') json = true
    else if (argv[index] === '--base-ref') { baseRef = argv[index + 1]; index += 1 }
    else throw new Error(`Unknown option: ${argv[index]}`)
  }
  const files = changedFiles(baseRef)
  const report = { baseRef, files, ...analyzeParity(files) }
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else {
    console.log(`Contract parity analysis for ${files.length} changed file(s):`)
    for (const [surface, changed] of Object.entries(report.surfaces)) console.log(`- ${surface}: ${changed ? 'changed' : 'not selected'}`)
    for (const finding of report.findings) console.log(`- ${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`)
  }
  if (strict && report.findings.some((finding) => finding.severity === 'error')) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try { main() } catch (error) { console.error(`[contract-parity] ${error.message}`); process.exitCode = 1 }
}
