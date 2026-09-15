#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const registryUrl = new URL('../references/repository-lifecycle.json', import.meta.url)

export function loadRepositoryLifecycle() {
  return JSON.parse(readFileSync(registryUrl, 'utf8'))
}

function normalizeRepository(value) {
  return value
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

export function evaluateRepositoryLifecycle(repository, options = {}) {
  const operation = options.operation ?? 'read'
  const allowHistorical = options.allowHistorical === true
  const registry = options.registry ?? loadRepositoryLifecycle()
  const normalized = normalizeRepository(repository)
  const entry = registry.repositories.find(
    (candidate) => normalizeRepository(candidate.fullName) === normalized,
  )

  if (!entry) {
    return {
      allowed: true,
      managed: false,
      repository,
      operation,
      status: 'unregistered',
      reason: 'Repository is not governed by the core EnterpriseGlue lifecycle registry.',
    }
  }

  const permittedOperations = registry.rules[entry.status]?.permittedOperations ?? []
  const historicalRead = operation === 'historical-read' && allowHistorical
  const allowed = entry.status === 'active'
    ? permittedOperations.includes(operation)
    : historicalRead && permittedOperations.includes(operation)

  return {
    allowed,
    managed: true,
    repository: entry.fullName,
    operation,
    status: entry.status,
    reason: allowed
      ? entry.status === 'retired'
        ? 'Explicit read-only historical audit permitted.'
        : 'Repository is active for this operation.'
      : entry.policy ?? `Repository lifecycle state ${entry.status} blocks ${operation}.`,
  }
}

function parseArguments(argv) {
  const values = { allowHistorical: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--allow-historical') {
      values.allowHistorical = true
    } else if (argument === '--repository') {
      values.repository = argv[index + 1]
      index += 1
    } else if (argument === '--operation') {
      values.operation = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (!values.repository) {
    throw new Error('--repository is required')
  }
  return values
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2))
    const result = evaluateRepositoryLifecycle(arguments_.repository, arguments_)
    console.log(JSON.stringify(result, null, 2))
    if (!result.allowed) process.exitCode = 2
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
