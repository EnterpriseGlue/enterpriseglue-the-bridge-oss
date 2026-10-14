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

function workflowContextKey(run) {
  if (!run.workflow_id || !run.head_branch || !run.event) return null
  return JSON.stringify([run.workflow_id, run.head_branch, run.event])
}

function contextKey(run) {
  const workflowContext = workflowContextKey(run)
  if (!workflowContext) return null
  const pullRequests = (run.pull_requests || []).map((pr) => pr.number).sort((a, b) => a - b)
  // A branch name alone cannot identify a pull request when GitHub omits its metadata.
  if (run.event.startsWith('pull_request') && !pullRequests.length && !run.head_sha) return null
  return JSON.stringify([
    workflowContext,
    pullRequests,
    run.event.startsWith('pull_request') && !pullRequests.length ? run.head_sha : null,
  ])
}

function latestContextRun(run, runs) {
  const key = contextKey(run)
  if (!key) return run
  return runs.filter((candidate) => contextKey(candidate) === key)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0] || run
}

function currentAttemptJobs(run, jobsByRun) {
  return (jobsByRun.get(run.id) || [])
    .filter((job) => Number(job.run_attempt || run.run_attempt || 1) === Number(run.run_attempt || 1))
}

function failedJobs(run, jobsByRun) {
  return currentAttemptJobs(run, jobsByRun)
    .filter((job) => ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(job.conclusion))
}

function coversFailedJobs(failures, recoveryJobs) {
  const available = [...recoveryJobs]
  return failures.length > 0 && failures.every((failed) => {
    const failedSteps = (failed.steps || []).filter((step) => step.conclusion === 'failure')
    const index = available.findIndex((candidate) => (
      candidate.name === failed.name
      && candidate.conclusion === 'success'
      && failedSteps.every((step) => (candidate.steps || []).some((replacement) => (
        replacement.name === step.name && replacement.conclusion === 'success'
      )))
    ))
    if (index < 0) return false
    available.splice(index, 1)
    return true
  })
}

function runEvidence(run, pullRequestsBySha) {
  const repoUrl = String(run.html_url || '').split('/actions/runs/')[0]
  const prs = [...(run.pull_requests || []), ...(pullRequestsBySha.get(run.head_sha) || [])]
  return {
    id: run.id,
    name: run.name,
    url: run.html_url,
    headSha: run.head_sha,
    branch: run.head_branch,
    event: run.event,
    attempt: Number(run.run_attempt || 1),
    conclusion: run.conclusion,
    pullRequests: [...new Map(prs.filter((pr) => pr.number).map((pr) => [pr.number, {
      number: pr.number,
      url: pr.html_url || `${repoUrl}/pull/${pr.number}`,
    }])).values()],
  }
}

export function buildFailureRecovery({ runs, jobsByRun = new Map(), pullRequestsBySha = new Map() }) {
  const result = { active: [], recovered: [], needsVerification: [], retries: [] }
  for (const run of runs.filter((candidate) => candidate.conclusion === 'failure')) {
    const latest = latestContextRun(run, runs)
    const failures = failedJobs(run, jobsByRun)
    const entry = {
      run: runEvidence(run, pullRequestsBySha),
      failedJobs: failures.map((job) => ({ name: job.name, url: job.html_url })),
      latestRun: runEvidence(latest, pullRequestsBySha),
    }
    if (latest.conclusion === 'failure') {
      if (run.retiredMergeQueueContext) {
        entry.reason = 'GitHub has retired this merge-queue branch; matching recovery evidence is missing. This historical observation is not an active queue blocker.'
        result.needsVerification.push(entry)
        continue
      }
      if ((run.pull_requests || []).some((pr) => pr.state === 'closed')) {
        entry.reason = 'The PR is closed, but no successful matching job evidence was found. This historical failure is not an active PR blocker.'
        result.needsVerification.push(entry)
        continue
      }
      entry.reason = latest.id === run.id
        ? 'No later completed run in the same workflow context.'
        : 'The latest completed run in the same workflow context still failed.'
      result.active.push(entry)
    } else if (latest.conclusion !== 'success') {
      entry.reason = `The latest matching run was ${latest.conclusion || 'unknown'}; it does not prove recovery.`
      result.needsVerification.push(entry)
    } else if (!coversFailedJobs(failures, currentAttemptJobs(latest, jobsByRun))) {
      entry.reason = 'A later run succeeded, but successful coverage of every failed job and step is missing (skipped work is not recovery).'
      result.needsVerification.push(entry)
    } else if (['workflow_dispatch', 'repository_dispatch', 'workflow_run', 'release'].includes(run.event)) {
      entry.reason = 'Failed jobs succeeded later; publication/dispatch inputs and artifact identity require separate verification.'
      result.needsVerification.push(entry)
    } else {
      entry.reason = 'The latest matching run succeeded, including every observed failed job and step. This is workflow recovery evidence, not proof of root cause or publication.'
      result.recovered.push(entry)
    }
  }
  for (const run of runs.filter((candidate) => Number(candidate.run_attempt || 1) > 1)) {
    result.retries.push({
      run: runEvidence(run, pullRequestsBySha),
      state: run.conclusion === 'success' ? 'succeeded_on_retry'
        : run.conclusion === 'failure' ? 'failed_after_retry'
          : run.conclusion === 'cancelled' ? `cancelled_${classifyCancelledRun(run, runs)}` : 'needs_verification',
      latestRun: runEvidence(latestContextRun(run, runs), pullRequestsBySha),
    })
  }
  return result
}

export function selectCiJobEvidenceRuns(runs, recentJobLimit = 120) {
  const selected = new Map([...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, recentJobLimit).map((run) => [run.id, run]))
  for (const run of runs) {
    if (run.conclusion === 'failure' || Number(run.run_attempt || 1) > 1) {
      selected.set(run.id, run)
      const latest = latestContextRun(run, runs)
      selected.set(latest.id, latest)
    }
    if (run.name === 'Docker Images' && run.event === 'release') selected.set(run.id, run)
  }
  return [...selected.values()]
}

export async function collectCiObservabilityEvidence({ github, owner, repo, since, until = new Date(), recentJobLimit = 120 }) {
  assert.ok(Number.isFinite(since.getTime()) && Number.isFinite(until.getTime()) && since <= until, 'invalid reporting window')
  async function fetchWindow(start, end) {
    const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
      owner, repo, status: 'completed', created: `${start.toISOString()}..${end.toISOString()}`, per_page: 100,
    })
    // GitHub caps searches using created/status filters at 1,000 runs, even when paginating.
    if (runs.length < 1000) return runs
    assert.ok(end - start > 1000, 'GitHub run cap reached within one second; full window evidence is unavailable')
    const middle = new Date(Math.floor((start.getTime() + end.getTime()) / 2))
    return [...await fetchWindow(start, middle), ...await fetchWindow(middle, end)]
  }
  const allRuns = await fetchWindow(since, until)
  const recentRuns = [...new Map(allRuns.filter((run) => (
    Date.parse(run.created_at) >= since.getTime() && Date.parse(run.created_at) <= until.getTime()
  )).map((run) => [run.id, run])).values()]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
    .map((run) => ({ ...run }))
  const incidents = recentRuns.filter((run) => run.conclusion === 'failure' || Number(run.run_attempt || 1) > 1)
  const incidentPrContexts = new Set(incidents.filter((run) => run.event?.startsWith('pull_request')).map(workflowContextKey).filter(Boolean))
  const associatedPrs = new Map()
  const prsByHead = new Map()
  async function lookupPrs(sha) {
    if (sha && !associatedPrs.has(sha)) {
      try {
        const prs = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
          owner, repo, commit_sha: sha, per_page: 100,
        })
        associatedPrs.set(sha, prs)
      } catch (error) {
        // Rewritten/garbage-collected PR commits may be absent; try the verified PR lifetime instead.
        if (error.status !== 404) throw error
        associatedPrs.set(sha, [])
      }
    }
    return associatedPrs.get(sha) || []
  }
  // Resolve missing PR context only for incident/recovery candidates, using exact commit associations.
  const runs = []
  for (const run of recentRuns) {
    if (!incidentPrContexts.has(workflowContextKey(run)) || (run.pull_requests || []).length) {
      runs.push(run)
      continue
    }
    let prs = (await lookupPrs(run.head_sha)).filter((pr) => (
      pr.head?.ref === run.head_branch
      && pr.base?.repo?.full_name === `${owner}/${repo}`
      && (!run.head_repository?.full_name || pr.head?.repo?.full_name === run.head_repository.full_name)
    ))
    if (!prs.length && run.head_repository?.full_name) {
      const head = `${run.head_repository.full_name.split('/')[0]}:${run.head_branch}`
      if (!prsByHead.has(head)) {
        prsByHead.set(head, await github.paginate(github.rest.pulls.list, {
          owner, repo, state: 'all', head, per_page: 100,
        }))
      }
      const created = Date.parse(run.created_at)
      prs = prsByHead.get(head).filter((pr) => (
        pr.head?.ref === run.head_branch
        && pr.head?.repo?.full_name === run.head_repository.full_name
        && pr.base?.repo?.full_name === `${owner}/${repo}`
        && Date.parse(pr.created_at) <= created
        && (!pr.closed_at || Date.parse(pr.closed_at) >= created)
      ))
    }
    runs.push(prs.length === 1 ? { ...run, pull_requests: prs } : run)
  }
  const queueBranches = new Map()
  for (const run of runs.filter((candidate) => candidate.event === 'merge_group' && candidate.conclusion === 'failure')) {
    if (latestContextRun(run, runs).conclusion !== 'failure') continue
    if (!queueBranches.has(run.head_branch)) {
      try {
        await github.rest.repos.getBranch({ owner, repo, branch: run.head_branch })
        queueBranches.set(run.head_branch, false)
      } catch (error) {
        if (error.status !== 404) throw error
        queueBranches.set(run.head_branch, true)
      }
    }
    run.retiredMergeQueueContext = queueBranches.get(run.head_branch)
  }
  const jobsByRun = new Map()
  const selected = selectCiJobEvidenceRuns(runs, recentJobLimit)
  // Bound API concurrency while including historical failures outside the timing sample.
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (next < selected.length) {
      const run = selected[next++]
      const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        owner, repo, run_id: run.id, filter: 'all', per_page: 100,
      })
      jobsByRun.set(run.id, jobs)
    }
  }))
  const pullRequestsBySha = new Map()
  const relatedRuns = runs.filter((run) => run.conclusion === 'failure' || Number(run.run_attempt || 1) > 1)
    .flatMap((run) => [run, latestContextRun(run, runs)])
  for (const sha of new Set(relatedRuns.filter((run) => !(run.pull_requests || []).length).map((run) => run.head_sha).filter(Boolean))) {
    const prs = await lookupPrs(sha)
    pullRequestsBySha.set(sha, prs.filter((pr) => pr.merged_at && pr.merge_commit_sha === sha))
  }
  return { runs, jobsByRun, pullRequestsBySha }
}

export function buildCiObservabilityReport({ runs, jobsByRun = new Map(), pullRequestsBySha = new Map(), daysBack = 7 }) {
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
  let releaseRebuilds = 0
  let applicationImageRetries = 0

  for (const run of runs) {
    if (run.conclusion === 'cancelled') {
      conclusions[`cancelled_${classifyCancelledRun(run, runs)}`] += 1
    } else if (Object.hasOwn(conclusions, run.conclusion)) {
      conclusions[run.conclusion] += 1
    } else {
      conclusions.other += 1
    }
    if (Number(run.run_attempt || 1) > 1) retries += 1
    if (
      Number(run.run_attempt || 1) === 1
      && ['success', 'failure'].includes(run.conclusion)
    ) {
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

    const runJobs = jobsByRun.get(run.id) || []
    if (
      run.name === 'Docker Images'
      && run.event === 'release'
      && runJobs.some((job) => /^build(?:\s*\/|$)/i.test(String(job.name || '')) && job.conclusion === 'success')
    ) {
      releaseRebuilds += 1
    }
    for (const job of runJobs) {
      if ((job.steps || []).some((step) => (
        String(step.name || '').includes('attempt 2 after transient failure')
        && step.conclusion === 'success'
      ))) {
        applicationImageRetries += 1
      }
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
    jobEvidenceRuns: runs.filter((run) => jobsByRun.has(run.id)).length,
    failureRecovery: buildFailureRecovery({ runs, jobsByRun, pullRequestsBySha }),
    conclusions,
    retries,
    releaseIntegrity: {
      releaseRebuilds,
      applicationImageRetries,
    },
    firstAttemptSuccessRate: firstAttempts
      ? Number((firstAttemptSuccesses / firstAttempts).toFixed(4))
      : 0,
    workflows,
    topJobs: jobs.slice(0, 10),
  }
}

export function evaluateCiSlo(report, {
  candidateP95Minutes = 45,
  minimumFirstAttemptSuccessRate = 0.9,
} = {}) {
  const breaches = []
  const candidate = report.workflows.find((workflow) => workflow.name === 'Release Candidate Stage')
  if (candidate && candidate.p95WallMinutes > candidateP95Minutes) {
    breaches.push({
      code: 'candidate_p95',
      message: `Release Candidate Stage p95 is ${candidate.p95WallMinutes}m (target <= ${candidateP95Minutes}m).`,
    })
  }
  if (report.firstAttemptSuccessRate < minimumFirstAttemptSuccessRate) {
    breaches.push({
      code: 'first_attempt_success',
      message: `First-attempt success is ${(report.firstAttemptSuccessRate * 100).toFixed(1)}% (target >= ${(minimumFirstAttemptSuccessRate * 100).toFixed(1)}%).`,
    })
  }
  if (report.conclusions.failure > 0) {
    breaches.push({ code: 'workflow_failures', message: `${report.conclusions.failure} completed workflow run(s) failed.` })
  }
  if (report.retries > 0) {
    breaches.push({ code: 'workflow_retries', message: `${report.retries} workflow run(s) required a retry.` })
  }
  if (report.releaseIntegrity.releaseRebuilds > 0) {
    breaches.push({
      code: 'release_rebuild',
      message: `${report.releaseIntegrity.releaseRebuilds} tagged release(s) rebuilt application images instead of promoting candidates.`,
    })
  }
  if (report.releaseIntegrity.applicationImageRetries > 0) {
    breaches.push({
      code: 'image_build_retry',
      message: `${report.releaseIntegrity.applicationImageRetries} application image job(s) used the second build attempt.`,
    })
  }
  return {
    status: breaches.length ? 'breached' : 'met',
    thresholds: { candidateP95Minutes, minimumFirstAttemptSuccessRate },
    breaches,
  }
}

function markdownText(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()<>|]/g, '\\$&')
}

function evidenceLink(label, url) {
  if (!/^https?:\/\/[^\s]+$/.test(String(url || ''))) return markdownText(label)
  return `[${markdownText(label)}](${url.replaceAll('(', '%28').replaceAll(')', '%29')})`
}

function runLink(run) {
  return evidenceLink(`${run.name || 'Workflow'} #${run.id} (attempt ${run.attempt})`, run.url)
}

function relatedPrLinks(entry) {
  const prs = [...entry.run.pullRequests, ...entry.latestRun.pullRequests]
  return [...new Map(prs.map((pr) => [pr.number, pr])).values()]
    .map((pr) => evidenceLink(`#${pr.number}`, pr.url)).join(', ') || '—'
}

function renderRecoveryMarkdown(report, limit = Infinity) {
  const recovery = report.failureRecovery
  if (!recovery) return []
  const lines = [
    '',
    '## Failure recovery evidence',
    '',
    `Failure observations: **${recovery.active.length} active**, **${recovery.recovered.length} with later successful job evidence**, **${recovery.needsVerification.length} needing verification**.`,
    '',
    'Recovery labels describe workflow/job evidence. Related PRs identify source context; they do not establish the cause of a failure. Publication and deployment acceptance require their own evidence.',
  ]
  for (const [key, title] of [
    ['active', 'Active failures'],
    ['recovered', 'Historical failures with recovery evidence'],
    ['needsVerification', 'Historical failures needing verification'],
  ]) {
    const entries = recovery[key]
    lines.push('', `### ${title}`, '', ...(entries.length ? [
      '| Failed run | Branch / trigger | Failed jobs | Latest matching run | Related PRs | Assessment |',
      '| --- | --- | --- | --- | --- | --- |',
      ...entries.slice(0, limit).map((entry) => `| ${runLink(entry.run)} | ${markdownText(entry.run.branch)} / ${markdownText(entry.run.event)} | ${entry.failedJobs.map((job) => evidenceLink(job.name, job.url)).join(', ') || 'Unavailable'} | ${runLink(entry.latestRun)}: ${markdownText(entry.latestRun.conclusion)} | ${relatedPrLinks(entry)} | ${markdownText(entry.reason)} |`),
      ...(entries.length > limit ? ['', `${entries.length - limit} additional observation(s) are in the retained report artifact.`] : []),
    ] : ['None.']))
  }
  lines.push('', '### Workflow retries', '', ...(recovery.retries.length ? [
    '| Retried run | Final outcome | Latest matching run | Related PRs |',
    '| --- | --- | --- | --- |',
    ...recovery.retries.slice(0, limit).map((entry) => `| ${runLink(entry.run)} | ${markdownText(entry.state)} | ${runLink(entry.latestRun)}: ${markdownText(entry.latestRun.conclusion)} | ${relatedPrLinks(entry)} |`),
    ...(recovery.retries.length > limit ? ['', `${recovery.retries.length - limit} additional retry observation(s) are in the retained report artifact.`] : []),
  ] : ['None.']))
  return lines
}

export function renderCiSloIssueBody(report, evidenceUrl) {
  const slo = report.slo || evaluateCiSlo(report)
  const render = (limit) => [
    `The rolling ${report.daysBack}-day EnterpriseGlue CI/release report detected:`,
    '',
    ...slo.breaches.map((breach) => `- **${breach.code}**: ${breach.message}`),
    '',
    'Historical failures and retries remain in the SLO counts after workflow recovery. This issue closes automatically only when the rolling window meets every existing threshold.',
    ...renderRecoveryMarkdown(report, limit),
    '',
    `Evidence: ${evidenceLink('Full report and retained JSON artifact', evidenceUrl)}`,
    '',
    'This issue is maintained by the scheduled observability workflow.',
  ].join('\n')
  // GitHub issue bodies have a size limit. Keep counts and artifact links even for large matrices.
  let limit = 20
  let body = render(limit)
  while (Buffer.byteLength(body) > 60_000 && limit > 0) {
    limit = Math.floor(limit / 2)
    body = render(limit)
  }
  assert.ok(Buffer.byteLength(body) <= 60_000, 'SLO issue summary exceeds its safe size budget')
  return body
}

export function renderCiObservabilityMarkdown(report) {
  const sloLines = report.slo
    ? [
        '',
        '## Release SLO assessment',
        '',
        `Status: **${report.slo.status}**`,
        ...(report.slo.breaches.length
          ? report.slo.breaches.map((breach) => `- **${breach.code}**: ${breach.message}`)
          : ['- No rolling threshold breaches detected.']),
      ]
    : []
  const lines = [
    '# Rolling CI and release observability',
    '',
    `Window: last ${report.daysBack} days`,
    `Analyzed workflow runs: ${report.analyzedRuns}`,
    `Job evidence coverage: ${report.jobEvidenceRuns ?? 'unknown'}/${report.analyzedRuns} runs (latest timing sample plus failures, retries, matching recovery runs, and tagged Docker releases). Job timings and image-build retry observations cover these fetched jobs.`,
    `First-attempt success rate: ${(report.firstAttemptSuccessRate * 100).toFixed(1)}%`,
    `Retries: ${report.retries}`,
    `Failures: ${report.conclusions.failure}`,
    `Superseded cancellations: ${report.conclusions.cancelled_superseded}`,
    `Manual/external cancellations: ${report.conclusions.cancelled_manual_or_external}`,
    `Tagged release rebuilds: ${report.releaseIntegrity.releaseRebuilds}`,
    `Application image build retries: ${report.releaseIntegrity.applicationImageRetries}`,
    ...sloLines,
    ...renderRecoveryMarkdown(report),
    '',
    '## Workflow critical paths',
    '',
    '| Workflow | Runs | p95 queue | p95 execution | p95 wall |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.workflows.map((workflow) => (
      `| ${markdownText(workflow.name)} | ${workflow.runs} | ${workflow.p95QueueMinutes}m | ${workflow.p95ExecutionMinutes}m | ${workflow.p95WallMinutes}m |`
    )),
    '',
    '## Highest runner-minute consumers',
    '',
    '| Job | Runs | Total | p95 |',
    '| --- | ---: | ---: | ---: |',
    ...report.topJobs.map((job) => `| ${markdownText(job.name)} | ${job.runs} | ${job.totalMinutes}m | ${job.p95Minutes}m |`),
    '',
  ]
  return lines.join('\n')
}
