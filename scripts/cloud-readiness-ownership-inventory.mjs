#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TENANT_EXECUTION_OWNERSHIP_V1,
  TENANT_PERSISTENCE_OWNERSHIP_V1,
} from '../packages/shared/src/db/tenant-ownership-inventory.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entityRoot = 'packages/shared/src/infrastructure/persistence/entities'
const executionRoot = 'packages/backend-host/src/plugins'
const defaultOutput = '.artifacts/cloud-readiness/tenant-ownership-inventory.json'

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await walk(path))
    if (entry.isFile()) paths.push(path)
  }
  return paths
}

export async function discoverTypeOrmEntities(projectRoot) {
  const directory = resolve(projectRoot, entityRoot)
  const files = (await walk(directory)).filter((path) => path.endsWith('.ts'))
  const entities = []
  const entityPattern = /@Entity\(\{\s*name:\s*'([^']+)'[^\n]*\}\)([\s\S]*?)(?=@Entity\(|$)/g
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    let match
    while ((match = entityPattern.exec(source)) !== null) {
      const className = match[2].match(/export\s+class\s+(\w+)/)?.[1]
      if (!className) {
        throw new Error(`Unable to resolve entity class for table ${match[1]} in ${relative(projectRoot, path)}`)
      }
      const columns = [...match[2].matchAll(/@(Column|PrimaryColumn)\(\{\s*name:\s*'([^']+)'/g)]
        .map((column) => column[2])
      entities.push({
        table: match[1],
        entity: className,
        source: relative(projectRoot, path).replaceAll('\\', '/'),
        columns: sortedUnique(columns),
      })
    }
  }
  return entities.sort((left, right) => left.table.localeCompare(right.table))
}

export async function discoverTimedPluginExecutions(projectRoot) {
  const directory = resolve(projectRoot, executionRoot)
  const files = (await walk(directory)).filter((path) => (
    path.endsWith('.ts') && !path.endsWith('.test.ts')
  ))
  const executions = []
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    if (!source.includes('setInterval(')) continue
    executions.push({
      source: relative(projectRoot, path).replaceAll('\\', '/'),
      contents: source,
    })
  }
  return executions.sort((left, right) => left.source.localeCompare(right.source))
}

export function validateOwnershipInventory({
  entities,
  timedExecutions,
  persistence = TENANT_PERSISTENCE_OWNERSHIP_V1,
  executions = TENANT_EXECUTION_OWNERSHIP_V1,
}) {
  const violations = []
  const discoveredByTable = new Map(entities.map((entity) => [entity.table, entity]))
  const classifiedByTable = new Map()
  for (const entry of persistence) {
    if (classifiedByTable.has(entry.table)) {
      violations.push(`duplicate persistence classification: ${entry.table}`)
    }
    classifiedByTable.set(entry.table, entry)
  }

  for (const entity of entities) {
    const classification = classifiedByTable.get(entity.table)
    if (!classification) {
      violations.push(`unclassified TypeORM entity: ${entity.table} (${entity.source})`)
      continue
    }
    const columns = new Set(entity.columns)
    for (const keyColumn of classification.keyColumns) {
      if (!columns.has(keyColumn)) {
        violations.push(`declared tenant key is missing: ${entity.table}.${keyColumn}`)
      }
    }
    if (
      classification.enforcement === 'postgres_forced_rls' &&
      !columns.has('tenant_id')
    ) {
      violations.push(`forced RLS classification must use tenant_id: ${entity.table}`)
    }
    for (const parentTable of classification.parentTables) {
      if (!discoveredByTable.has(parentTable)) {
        violations.push(`declared ownership parent is missing: ${entity.table} -> ${parentTable}`)
      }
    }
  }
  for (const entry of persistence) {
    if (!discoveredByTable.has(entry.table)) {
      violations.push(`stale persistence classification: ${entry.table}`)
    }
  }

  const discoveredExecutions = new Map(timedExecutions.map((entry) => [entry.source, entry]))
  const classifiedExecutions = new Map()
  for (const entry of executions) {
    if (classifiedExecutions.has(entry.source)) {
      violations.push(`duplicate execution classification: ${entry.source}`)
    }
    classifiedExecutions.set(entry.source, entry)
    const discovered = discoveredExecutions.get(entry.source)
    if (!discovered) {
      violations.push(`stale timed execution classification: ${entry.source}`)
      continue
    }
    for (const token of entry.requiredSourceTokens) {
      if (!discovered.contents.includes(token)) {
        violations.push(`execution evidence token is missing: ${entry.source} -> ${token}`)
      }
    }
    for (const table of entry.stateTables) {
      if (!classifiedByTable.has(table)) {
        violations.push(`execution state table is unclassified: ${entry.id} -> ${table}`)
      }
    }
  }
  for (const execution of timedExecutions) {
    if (!classifiedExecutions.has(execution.source)) {
      violations.push(`unclassified timed plugin execution: ${execution.source}`)
    }
  }

  if (violations.length > 0) {
    throw new Error(`Tenant ownership inventory is invalid:\n- ${sortedUnique(violations).join('\n- ')}`)
  }
}

function countBy(entries, key) {
  return Object.fromEntries(
    [...entries.reduce((counts, entry) => {
      const value = entry[key]
      counts.set(value, (counts.get(value) || 0) + 1)
      return counts
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
}

export async function buildOwnershipInventory(projectRoot, options = {}) {
  const persistence = options.persistence ?? TENANT_PERSISTENCE_OWNERSHIP_V1
  const executions = options.executions ?? TENANT_EXECUTION_OWNERSHIP_V1
  const entities = await discoverTypeOrmEntities(projectRoot)
  const timedExecutions = await discoverTimedPluginExecutions(projectRoot)
  validateOwnershipInventory({ entities, timedExecutions, persistence, executions })

  const classifications = new Map(persistence.map((entry) => [entry.table, entry]))
  const persistenceInventory = entities.map((entity) => ({
    ...entity,
    ...classifications.get(entity.table),
  }))
  return {
    schemaVersion: 1,
    sourceBaseline: 'EnterpriseGlue OSS TypeORM entities and timed plugin execution registrations',
    summary: {
      persistenceEntries: persistenceInventory.length,
      executionEntries: executions.length,
      persistenceScopes: countBy(persistenceInventory, 'scope'),
      enforcementModes: countBy(persistenceInventory, 'enforcement'),
    },
    persistence: persistenceInventory,
    execution: [...executions].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

export async function writeOwnershipInventory(projectRoot, outputPath = defaultOutput) {
  const inventory = await buildOwnershipInventory(projectRoot)
  const absoluteOutput = resolve(projectRoot, outputPath)
  await mkdir(dirname(absoluteOutput), { recursive: true })
  await writeFile(absoluteOutput, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  return { inventory, outputPath }
}

async function main() {
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
  const outputPath = outputArgument?.slice('--output='.length) || defaultOutput
  const result = await writeOwnershipInventory(root, outputPath)
  process.stdout.write(
    `Tenant ownership inventory valid: ${result.inventory.summary.persistenceEntries} persistence entries, ` +
    `${result.inventory.summary.executionEntries} timed plugin execution entries; wrote ${result.outputPath}\n`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
