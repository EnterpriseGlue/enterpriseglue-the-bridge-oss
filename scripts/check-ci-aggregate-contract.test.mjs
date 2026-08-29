import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assertAggregateCoverage,
  parseAggregateNeeds,
  parseWorkflowJobIds,
} from './check-ci-aggregate-contract.mjs'

const workflow = await readFile(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)

test('ci-complete explicitly covers every CI job', () => {
  const result = assertAggregateCoverage(workflow)
  assert.ok(result.coveredJobs.includes('plugin-platform'))
  assert.ok(result.coveredJobs.includes('plugin-platform-images'))
  assert.ok(result.coveredJobs.includes('release-readiness'))
  assert.deepEqual(
    new Set(parseAggregateNeeds(workflow)),
    new Set(parseWorkflowJobIds(workflow).filter((jobId) => jobId !== 'ci-complete')),
  )
})

test('aggregate coverage fails when an existing job is omitted', () => {
  const withoutPluginPlatform = workflow.replace('      - plugin-platform\n', '')
  assert.throws(
    () => assertAggregateCoverage(withoutPluginPlatform),
    /must depend on every other workflow job/,
  )
})

test('aggregate coverage fails closed when a new job is added without a dependency edge', () => {
  const withUncoveredJob = workflow.replace(
    '\n  ci-complete:\n',
    '\n  newly-added-job:\n    runs-on: ubuntu-latest\n    steps: []\n\n  ci-complete:\n',
  )
  assert.throws(
    () => assertAggregateCoverage(withUncoveredJob),
    /must depend on every other workflow job/,
  )
})
