import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  buildCiObservabilityReport,
  classifyCancelledRun,
  evaluateCiSlo,
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
  assert.equal(report.firstAttemptSuccessRate, 0.5)
  assert.match(renderCiObservabilityMarkdown(report), /Superseded cancellations/)
})

test('SLO assessment reports candidate duration, failures, retries, and release rebuilds', () => {
  const runs = [
    run({ id: 1, name: 'Release Candidate Stage', updated_at: '2026-09-01T00:51:00Z' }),
    run({ id: 2, name: 'Docker Images', event: 'release', conclusion: 'failure', run_attempt: 2 }),
    run({ id: 3, name: 'CI', conclusion: 'failure' }),
  ]
  const jobs = new Map([[2, [{
    name: 'build / Build backend application image (linux/arm64)',
    conclusion: 'success',
    started_at: runs[1].run_started_at,
    completed_at: runs[1].updated_at,
    steps: [{ name: 'Build attempt 2 after transient failure', conclusion: 'success' }],
  }]]])
  const report = buildCiObservabilityReport({ runs, jobsByRun: jobs })
  const assessment = evaluateCiSlo(report)
  assert.equal(assessment.status, 'breached')
  assert.deepEqual(assessment.breaches.map(({ code }) => code), [
    'candidate_p95',
    'first_attempt_success',
    'workflow_failures',
    'workflow_retries',
    'release_rebuild',
    'image_build_retry',
  ])
})

test('first-attempt reliability excludes superseded, manual, and skipped runs', () => {
  const runs = [
    run({ id: 1 }),
    run({ id: 2, conclusion: 'cancelled' }),
    run({ id: 3, conclusion: 'skipped' }),
  ]
  const report = buildCiObservabilityReport({ runs })
  assert.equal(report.firstAttemptSuccessRate, 1)
})

test('SLO assessment passes a clean, fast representative window', () => {
  const report = buildCiObservabilityReport({
    runs: [run({ name: 'Release Candidate Stage', updated_at: '2026-09-01T00:41:00Z' })],
  })
  assert.equal(evaluateCiSlo(report).status, 'met')
})

test('scheduled workflow collects repository-wide CI and release evidence', () => {
  const workflow = fs.readFileSync('.github/workflows/ci-cost-report.yml', 'utf8')
  assert.match(workflow, /listWorkflowRunsForRepo/)
  assert.match(workflow, /filter: 'all'/)
  assert.match(workflow, /ci-release-observability\.json/)
  assert.match(workflow, /evaluateCiSlo/)
  assert.match(workflow, /\[CI SLO\] Release pipeline threshold breach/)
  assert.doesNotMatch(workflow, /workflowId = 'ci\.yml'/)
})
