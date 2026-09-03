import assert from 'node:assert/strict'

function minutesBetween(start, end) {
  const startMs = Date.parse(String(start || ''))
  const endMs = Date.parse(String(end || ''))
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
    ? (endMs - startMs) / 60_000
    : null
}

export function percentile(values, fraction) {
  assert.ok(fraction >= 0 && fraction <= 1, 'percentile must be between zero and one')
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

export function classifyCancelledRun(run, runs) {
  if (run.conclusion !== 'cancelled') return null
  const created = Date.parse(run.created_at)
  const superseding = runs.some((candidate) => (
    candidate.id !== run.id
    && candidate.workflow_id === run.workflow_id
    && candidate.head_branch === run.head_branch
    && Date.parse(candidate.created_at) > created
    && Date.parse(candidate.created_at) - created <= 2 * 60 * 60 * 1000
  ))
  return superseding ? 'superseded' : 'manual_or_external'
}

export function buildCiObservabilityReport({ runs, jobsByRun = new Map(), daysBack = 7 }) {
  assert.ok(Array.isArray(runs), 'runs must be an array')
  const conclusions = {
    success: 0,
    failure: 0,
    cancelled_superseded: 0,
    cancelled_manual_or_external: 0,
    skipped: 0,
    other: 0,
  }
  const workflowBuckets = new Map()
  const jobBuckets = new Map()
  let retries = 0
  let firstAttemptSuccesses = 0
  let firstAttempts = 0

  for (const run of runs) {
    if (run.conclusion === 'cancelled') {
      conclusions[`cancelled_${classifyCancelledRun(run, runs)}`] += 1
    } else if (Object.hasOwn(conclusions, run.conclusion)) {
      conclusions[run.conclusion] += 1
    } else {
      conclusions.other += 1
    }
    if (Number(run.run_attempt || 1) > 1) retries += 1
    if (Number(run.run_attempt || 1) === 1) {
      firstAttempts += 1
      if (run.conclusion === 'success') firstAttemptSuccesses += 1
    }

    const name = String(run.name || `workflow-${run.workflow_id || 'unknown'}`)
    const bucket = workflowBuckets.get(name) || { name, runs: 0, queue: [], execution: [], wall: [], conclusions: {} }
    bucket.runs += 1
    const queue = minutesBetween(run.created_at, run.run_started_at)
    const execution = minutesBetween(run.run_started_at, run.updated_at)
    const wall = minutesBetween(run.created_at, run.updated_at)
    if (queue !== null) bucket.queue.push(queue)
    if (execution !== null) bucket.execution.push(execution)
    if (wall !== null) bucket.wall.push(wall)
    bucket.conclusions[run.conclusion || 'unknown'] = (bucket.conclusions[run.conclusion || 'unknown'] || 0) + 1
    workflowBuckets.set(name, bucket)

    for (const job of jobsByRun.get(run.id) || []) {
      const duration = minutesBetween(job.started_at, job.completed_at)
      if (duration === null) continue
      const jobName = String(job.name || 'unknown')
      const jobBucket = jobBuckets.get(jobName) || { name: jobName, durations: [], conclusions: {} }
      jobBucket.durations.push(duration)
      jobBucket.conclusions[job.conclusion || 'unknown'] = (jobBucket.conclusions[job.conclusion || 'unknown'] || 0) + 1
      jobBuckets.set(jobName, jobBucket)
    }
  }

  const workflows = [...workflowBuckets.values()].map((bucket) => ({
    name: bucket.name,
    runs: bucket.runs,
    p50QueueMinutes: Number(percentile(bucket.queue, 0.5).toFixed(2)),
    p95QueueMinutes: Number(percentile(bucket.queue, 0.95).toFixed(2)),
    p50ExecutionMinutes: Number(percentile(bucket.execution, 0.5).toFixed(2)),
    p95ExecutionMinutes: Number(percentile(bucket.execution, 0.95).toFixed(2)),
    p95WallMinutes: Number(percentile(bucket.wall, 0.95).toFixed(2)),
    conclusions: bucket.conclusions,
  })).sort((left, right) => right.p95WallMinutes - left.p95WallMinutes)

  const jobs = [...jobBuckets.values()].map((bucket) => ({
    name: bucket.name,
    runs: bucket.durations.length,
    totalMinutes: Number(bucket.durations.reduce((sum, value) => sum + value, 0).toFixed(2)),
    p95Minutes: Number(percentile(bucket.durations, 0.95).toFixed(2)),
    conclusions: bucket.conclusions,
  })).sort((left, right) => right.totalMinutes - left.totalMinutes)

  return {
    schemaVersion: 'enterpriseglue-ci-observability/v2',
    generatedAt: new Date().toISOString(),
    daysBack,
    analyzedRuns: runs.length,
    conclusions,
    retries,
    firstAttemptSuccessRate: firstAttempts
      ? Number((firstAttemptSuccesses / firstAttempts).toFixed(4))
      : 0,
    workflows,
    topJobs: jobs.slice(0, 10),
  }
}

export function renderCiObservabilityMarkdown(report) {
  const lines = [
    '# Weekly CI and release observability',
    '',
    `Window: last ${report.daysBack} days`,
    `Analyzed workflow runs: ${report.analyzedRuns}`,
    `First-attempt success rate: ${(report.firstAttemptSuccessRate * 100).toFixed(1)}%`,
    `Retries: ${report.retries}`,
    `Failures: ${report.conclusions.failure}`,
    `Superseded cancellations: ${report.conclusions.cancelled_superseded}`,
    `Manual/external cancellations: ${report.conclusions.cancelled_manual_or_external}`,
    '',
    '## Workflow critical paths',
    '',
    '| Workflow | Runs | p95 queue | p95 execution | p95 wall |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.workflows.map((workflow) => (
      `| ${workflow.name} | ${workflow.runs} | ${workflow.p95QueueMinutes}m | ${workflow.p95ExecutionMinutes}m | ${workflow.p95WallMinutes}m |`
    )),
    '',
    '## Highest runner-minute consumers',
    '',
    '| Job | Runs | Total | p95 |',
    '| --- | ---: | ---: | ---: |',
    ...report.topJobs.map((job) => `| ${job.name} | ${job.runs} | ${job.totalMinutes}m | ${job.p95Minutes}m |`),
    '',
  ]
  return lines.join('\n')
}
