#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export function parseWorkflowJobIds(workflow) {
  const lines = workflow.split(/\r?\n/)
  const jobsIndex = lines.findIndex((line) => line === 'jobs:')
  assert.notEqual(jobsIndex, -1, 'workflow is missing the top-level jobs mapping')

  return lines
    .slice(jobsIndex + 1)
    .map((line) => line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/)?.[1] || '')
    .filter(Boolean)
}

export function parseAggregateNeeds(workflow, aggregateJob = 'ci-complete') {
  const lines = workflow.split(/\r?\n/)
  const aggregateIndex = lines.findIndex((line) => line === `  ${aggregateJob}:`)
  assert.notEqual(aggregateIndex, -1, `workflow is missing ${aggregateJob}`)

  const block = []
  for (let index = aggregateIndex + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[index])) break
    block.push(lines[index])
  }

  const needsIndex = block.findIndex((line) => /^    needs:/.test(line))
  assert.notEqual(needsIndex, -1, `${aggregateJob} must declare explicit needs`)

  const inline = block[needsIndex].match(/^    needs:\s*\[([^\]]*)\]\s*$/)?.[1]
  if (inline !== undefined) {
    return inline.split(',').map((value) => value.trim()).filter(Boolean)
  }

  const needs = []
  for (let index = needsIndex + 1; index < block.length; index += 1) {
    const match = block[index].match(/^      - ([A-Za-z0-9_-]+)\s*$/)
    if (match) {
      needs.push(match[1])
      continue
    }
    if (block[index].trim() !== '') break
  }
  return needs
}

export function assertAggregateCoverage(workflow, aggregateJob = 'ci-complete') {
  const jobIds = parseWorkflowJobIds(workflow)
  const needs = parseAggregateNeeds(workflow, aggregateJob)
  const expected = jobIds.filter((jobId) => jobId !== aggregateJob).sort()
  const actual = [...needs].sort()

  assert.equal(new Set(needs).size, needs.length, `${aggregateJob} contains duplicate needs`)
  assert.deepEqual(
    actual,
    expected,
    `${aggregateJob} must depend on every other workflow job`,
  )

  const aggregateStart = workflow.indexOf(`  ${aggregateJob}:\n`)
  const aggregateBlock = workflow.slice(aggregateStart)
  assert.match(aggregateBlock, /^    if: always\(\)$/m, `${aggregateJob} must always run`)

  return { aggregateJob, coveredJobs: needs }
}

async function main() {
  const workflowPath = process.argv[2] || '.github/workflows/ci.yml'
  const workflow = await readFile(workflowPath, 'utf8')
  const result = assertAggregateCoverage(workflow)
  process.stdout.write(`${JSON.stringify({ status: 'passed', ...result })}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
