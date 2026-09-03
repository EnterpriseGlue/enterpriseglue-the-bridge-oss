import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  buildCiObservabilityReport,
  classifyCancelledRun,
  percentile,
  renderCiObservabilityMarkdown,
} from './ci-observability.mjs'

const run = (overrides = {}) => ({
  id: 1,
  workflow_id: 10,
  name: 'CI',
  head_branch: 'change',
  conclusion: 'success',
  run_attempt: 1,
  created_at: '2026-09-01T00:00:00Z',
  run_started_at: '2026-09-01T00:01:00Z',
  updated_at: '2026-09-01T00:11:00Z',
  ...overrides,
})

test('percentile reports observed p50 and p95 values', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2)
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4)
})

test('cancellations superseded by a newer same-branch workflow are not failures', () => {
  const cancelled = run({ id: 1, conclusion: 'cancelled' })
  const replacement = run({ id: 2, created_at: '2026-09-01T00:20:00Z' })
  assert.equal(classifyCancelledRun(cancelled, [cancelled, replacement]), 'superseded')
  assert.equal(classifyCancelledRun(cancelled, [cancelled]), 'manual_or_external')
})

test('report separates conclusions and exposes workflow and job p95', () => {
  const runs = [
    run(),
    run({ id: 2, conclusion: 'failure', updated_at: '2026-09-01T00:21:00Z' }),
    run({ id: 3, conclusion: 'cancelled', created_at: '2026-09-01T01:00:00Z', run_started_at: '2026-09-01T01:01:00Z', updated_at: '2026-09-01T01:02:00Z' }),
  ]
  const jobs = new Map([[1, [{ name: 'test', conclusion: 'success', started_at: runs[0].run_started_at, completed_at: runs[0].updated_at }]]])
  const report = buildCiObservabilityReport({ runs, jobsByRun: jobs })
  assert.equal(report.conclusions.success, 1)
  assert.equal(report.conclusions.failure, 1)
  assert.equal(report.conclusions.cancelled_manual_or_external, 1)
  assert.equal(report.workflows[0].p95WallMinutes, 21)
  assert.equal(report.topJobs[0].totalMinutes, 10)
  assert.match(renderCiObservabilityMarkdown(report), /Superseded cancellations/)
})

test('scheduled workflow collects repository-wide CI and release evidence', () => {
  const workflow = fs.readFileSync('.github/workflows/ci-cost-report.yml', 'utf8')
  assert.match(workflow, /listWorkflowRunsForRepo/)
  assert.match(workflow, /filter: 'all'/)
  assert.match(workflow, /ci-release-observability\.json/)
  assert.doesNotMatch(workflow, /workflowId = 'ci\.yml'/)
})
