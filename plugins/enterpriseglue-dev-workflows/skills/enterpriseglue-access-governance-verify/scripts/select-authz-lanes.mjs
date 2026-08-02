#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LANE_COMMANDS = Object.freeze({
  structure: 'pnpm run test:authz:structure',
  decisions: 'pnpm run test:authz:pr',
  fineGrained: 'pnpm run test:authz:fine-grained:local',
  identity: 'pnpm run test:identity:verify',
  protocols: 'pnpm run test:identity:protocol-rehearsal',
  browser: 'pnpm run test:authz:browser',
  accessibility: 'pnpm run test:authz:accessibility:cross-browser',
  engineTenancy: 'pnpm run test:engine-tenancy:release-evidence',
  operatonBackstop: 'pnpm run test:authz:adapter-backstop',
  databasePortability: 'pnpm run test:engine-tenancy:database-matrix',
  deploymentEvidence: 'pnpm run test:deployment-evidence:local',
})

export function selectAuthzLanes(files, { all = false } = {}) {
  if (all) return Object.keys(LANE_COMMANDS)
  const selected = new Set()
  const any = (pattern) => files.some((file) => pattern.test(file))
  const governance = any(/authz|authorization|identity|sso|engine-tenancy|engineBackstop|engine-backstop|customer-sidecar/i)
  if (governance) selected.add('structure')
  if (any(/authz|permissions?|roles?|assignments?|polic|tenant|runtimeResource/i)) selected.add('decisions')
  if (any(/permissions?|custom-role|machine-principal|apiClient|serviceAccount|variable|mutation/i)) selected.add('fineGrained')
  if (any(/identity|sso|oidc|saml|ldap|login|session|reconcil/i)) {
    selected.add('identity'); selected.add('protocols')
  }
  if (any(/^(?:frontend|packages\/frontend-host)\/src\/.*(?:access|identity|role|engine)/i)) {
    selected.add('browser'); selected.add('accessibility')
  }
  if (any(/engine-tenancy|engineTenant|engineSet|runtimeResource|provisioning/i)) selected.add('engineTenancy')
  if (any(/operaton|backstop|sidecar|bpmn-engine-client|engine-native/i)) selected.add('operatonBackstop')
  if (any(/migrations?|entities|persistence|repository|database/i)) selected.add('databasePortability')
  if (governance && any(/infra\/|docker|deployment-evidence/i)) selected.add('deploymentEvidence')
  return [...selected]
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
  let baseRef = 'origin/main'; let json = false; let all = false
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json') json = true
    else if (argv[index] === '--all') all = true
    else if (argv[index] === '--base-ref') { baseRef = argv[index + 1]; index += 1 }
    else throw new Error(`Unknown option: ${argv[index]}`)
  }
  const files = changedFiles(baseRef)
  const lanes = selectAuthzLanes(files, { all })
  const result = lanes.map((lane) => ({ lane, command: LANE_COMMANDS[lane] }))
  if (json) process.stdout.write(`${JSON.stringify({ baseRef, files, lanes: result }, null, 2)}\n`)
  else {
    console.log(`Selected ${result.length} access-governance lane(s) from ${files.length} changed file(s):`)
    for (const entry of result) console.log(`- ${entry.lane}: ${entry.command}`)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try { main() } catch (error) { console.error(`[authz-lanes] ${error.message}`); process.exitCode = 1 }
}
