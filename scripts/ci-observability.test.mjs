import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  buildCiObservabilityReport,
  buildFailureRecovery,
  classifyCancelledRun,
  collectCiObservabilityEvidence,
  evaluateCiSlo,
  percentile,
  renderCiObservabilityMarkdown,
  renderCiSloIssueBody,
  selectCiJobEvidenceRuns,
} from './ci-observability.mjs'

const run = (overrides = {}) => ({
  id: 1,
  workflow_id: 10,
  name: 'CI',
  head_branch: 'change',
  head_sha: 'old-source',
  event: 'push',
  pull_requests: [],
  html_url: 'https://github.com/owner/repo/actions/runs/1',
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

const failure = (overrides = {}) => run({ conclusion: 'failure', ...overrides })
const later = (overrides = {}) => run({
  id: 2,
  html_url: 'https://github.com/owner/repo/actions/runs/2',
  head_sha: 'new-source',
  created_at: '2026-09-01T01:00:00Z',
  run_started_at: '2026-09-01T01:01:00Z',
  updated_at: '2026-09-01T01:11:00Z',
  ...overrides,
})
const job = (conclusion, overrides = {}) => ({
  name: 'test',
  conclusion,
  run_attempt: 1,
  html_url: 'https://github.com/owner/repo/actions/runs/1/job/11',
  steps: [{ name: 'Run tests', conclusion }],
  ...overrides,
})

test('recovery links successful failed-job coverage and related PRs without removing SLO history', () => {
  const runs = [failure(), later()]
  const report = buildCiObservabilityReport({
    runs,
    jobsByRun: new Map([[1, [job('failure')]], [2, [job('success')]]]),
    pullRequestsBySha: new Map([['new-source', [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }]]]),
  })
  assert.equal(report.schemaVersion, 'enterpriseglue-ci-observability/v2')
  assert.equal(report.failureRecovery.recovered.length, 1)
  assert.equal(report.failureRecovery.active.length, 0)
  assert.equal(report.failureRecovery.needsVerification.length, 0)
  assert.equal(report.conclusions.failure, 1)
  assert.equal(report.firstAttemptSuccessRate, 0.5)
  assert.ok(evaluateCiSlo(report).breaches.some((breach) => breach.code === 'workflow_failures'))
  const issue = renderCiSloIssueBody(report, 'https://github.com/owner/repo/actions/runs/999')
  assert.match(issue, /\*\*0 active\*\*/)
  assert.match(issue, /Historical failures with recovery evidence/)
  for (const url of ['/actions/runs/1', '/actions/runs/2', '/pull/42', '/actions/runs/999']) assert.ok(issue.includes(url))
  assert.match(issue, /closes automatically only when the rolling window meets every existing threshold/)
  assert.match(renderCiObservabilityMarkdown(report), /Job evidence coverage: 2\/2/)
})

test('a green run in another workflow, branch, trigger or PR is never recovery evidence', () => {
  const failed = failure({ event: 'pull_request', pull_requests: [{ number: 7 }] })
  for (const changedContext of [
    { workflow_id: 11 }, { head_branch: 'other' }, { event: 'push' }, { pull_requests: [{ number: 8 }] },
  ]) {
    const candidate = later({ event: 'pull_request', pull_requests: [{ number: 7 }], ...changedContext })
    const result = buildFailureRecovery({
      runs: [failed, candidate], jobsByRun: new Map([[1, [job('failure')]], [2, [job('success')]]]),
    })
    assert.equal(result.active.length, 1)
    assert.equal(result.recovered.length, 0)
    assert.equal(result.active[0].latestRun.id, 1)
  }
})

test('PR recovery requires the same PR or the same SHA when PR metadata is absent', () => {
  for (const pull_requests of [[], [{ number: 7 }]]) {
    const runs = [failure({ event: 'pull_request', pull_requests }), later({ event: 'pull_request', pull_requests })]
    const jobsByRun = new Map([[1, [job('failure')]], [2, [job('success')]]])
    assert.equal(buildFailureRecovery({ runs, jobsByRun }).recovered.length, pull_requests.length ? 1 : 0)
    runs[1].head_sha = runs[0].head_sha
    assert.equal(buildFailureRecovery({ runs, jobsByRun }).recovered.length, 1)
  }
})

test('a newer failed run keeps the context active even after an intervening green run', () => {
  const newest = failure({ id: 3, created_at: '2026-09-01T02:00:00Z' })
  const result = buildFailureRecovery({
    runs: [later(), failure(), newest],
    jobsByRun: new Map([[1, [job('failure')]], [2, [job('success')]], [3, [job('failure')]]]),
  })
  assert.equal(result.active.length, 2)
  assert.equal(result.recovered.length, 0)
  assert.ok(result.active.every((entry) => entry.latestRun.id === 3))
})

test('skipped or missing failed jobs and steps require verification despite a green run', () => {
  for (const jobs of [[], [job('skipped')], [job('success', { name: 'other' })],
    [job('success', { steps: [] })], [job('success', { steps: [{ name: 'Run tests', conclusion: 'skipped' }] })]]) {
    const result = buildFailureRecovery({
      runs: [failure(), later()], jobsByRun: new Map([[1, [job('failure')]], [2, jobs]]),
    })
    assert.equal(result.needsVerification.length, 1)
    assert.equal(result.recovered.length, 0)
  }
  assert.equal(buildFailureRecovery({ runs: [failure(), later()] }).needsVerification.length, 1)
})

test('duplicate failed job names require separate successful replacement jobs', () => {
  const result = buildFailureRecovery({
    runs: [failure(), later()],
    jobsByRun: new Map([[1, [job('failure'), job('failure')]], [2, [job('success')]]]),
  })
  assert.equal(result.recovered.length, 0)
})

test('earlier attempts and latest cancelled/skipped runs do not establish recovery', () => {
  const runs = [failure(), later({ run_attempt: 2 })]
  const jobsByRun = new Map([[1, [job('failure')]], [2, [job('success'), job('skipped', { run_attempt: 2 })]]])
  assert.equal(buildFailureRecovery({ runs, jobsByRun }).recovered.length, 0)
  for (const conclusion of ['cancelled', 'skipped', 'timed_out']) {
    runs[1].conclusion = conclusion
    const result = buildFailureRecovery({ runs, jobsByRun })
    assert.equal(result.needsVerification.length, 1)
    assert.equal(result.recovered.length, 0)
  }
})

test('publication and manual/upstream dispatches keep artifact/input acceptance separate', () => {
  for (const event of ['workflow_dispatch', 'repository_dispatch', 'workflow_run', 'release']) {
    const result = buildFailureRecovery({
      runs: [failure({ event }), later({ event })],
      jobsByRun: new Map([[1, [job('failure')]], [2, [job('success')]]]),
    })
    assert.equal(result.needsVerification.length, 1)
    assert.equal(result.recovered.length, 0)
    assert.match(result.needsVerification[0].reason, /artifact identity require separate verification/)
  }
})

test('successful, failed, superseded and external cancelled retries retain their SLO count', () => {
  const runs = [
    run({ id: 1, run_attempt: 2 }),
    failure({ id: 2, run_attempt: 2 }),
    run({ id: 3, workflow_id: 11, run_attempt: 2, conclusion: 'cancelled' }),
    later({ id: 4, workflow_id: 11 }),
    run({ id: 5, workflow_id: 12, run_attempt: 2, conclusion: 'cancelled' }),
  ]
  const report = buildCiObservabilityReport({ runs })
  assert.equal(report.retries, 4)
  assert.deepEqual(report.failureRecovery.retries.map((entry) => entry.state), [
    'succeeded_on_retry', 'failed_after_retry', 'cancelled_superseded', 'cancelled_manual_or_external',
  ])
  assert.ok(evaluateCiSlo(report).breaches.some((breach) => breach.code === 'workflow_retries'))
})

test('historical failures, retries, recovery runs and release integrity are fetched outside the timing sample', () => {
  const runs = [
    failure(), later(), run({ id: 3, workflow_id: 11, run_attempt: 2 }),
    run({ id: 4, name: 'Docker Images', event: 'release' }),
    later({ id: 5, workflow_id: 12, created_at: '2026-09-02T00:00:00Z' }),
  ]
  assert.deepEqual(selectCiJobEvidenceRuns(runs, 1).map(({ id }) => id).sort(), [1, 2, 3, 4, 5])
})

test('collector counts the full window, bounds job concurrency and links actual merged source PRs', async () => {
  const runs = Array.from({ length: 205 }, (_, index) => later({ id: index + 2, workflow_id: index + 20 }))
  runs.push(failure(), later({ id: 999 }), run({ id: 1000, created_at: '2026-08-01T00:00:00Z' }))
  const calls = []
  let active = 0
  let peak = 0
  const github = {
    rest: { actions: { listWorkflowRunsForRepo: 'runs', listJobsForWorkflowRun: 'jobs' }, repos: { listPullRequestsAssociatedWithCommit: 'prs' }, pulls: { list: 'pulls' } },
    async paginate(endpoint, args) {
      calls.push({ endpoint, args })
      if (endpoint === 'runs') return runs
      if (endpoint === 'prs') return [
        { number: 42, merged_at: 'now', merge_commit_sha: args.commit_sha },
        { number: 43, merged_at: null, merge_commit_sha: args.commit_sha },
        { number: 44, merged_at: 'now', merge_commit_sha: 'unrelated' },
      ]
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setImmediate(resolve))
      active--
      return [job(args.run_id === 1 ? 'failure' : 'success')]
    },
  }
  const evidence = await collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: new Date('2026-09-01T00:00:00Z'), recentJobLimit: 5 })
  const report = buildCiObservabilityReport(evidence)
  assert.equal(report.analyzedRuns, 207)
  assert.equal(report.conclusions.failure, 1)
  assert.equal(report.failureRecovery.recovered.length, 1)
  assert.ok(peak > 1 && peak <= 4)
  assert.equal(calls[0].args.status, 'completed')
  assert.ok(calls.filter(({ endpoint }) => endpoint === 'jobs').every(({ args }) => args.filter === 'all'))
  assert.deepEqual(evidence.pullRequestsBySha.get('new-source').map(({ number }) => number), [42])
})

test('collection errors fail closed rather than emit a clean partial report', async () => {
  const github = {
    rest: { actions: { listWorkflowRunsForRepo: 'runs', listJobsForWorkflowRun: 'jobs' } },
    async paginate(endpoint) {
      if (endpoint === 'runs') return [run()]
      throw new Error('API unavailable')
    },
  }
  await assert.rejects(collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: new Date('2026-09-01T00:00:00Z') }), /API unavailable/)
})

test('collector resolves omitted PR context from unique commit associations without guessing', async () => {
  const old = failure({ event: 'pull_request', head_repository: { full_name: 'owner/repo' } })
  const newer = later({ event: 'pull_request', head_repository: { full_name: 'owner/repo' } })
  const pr = { number: 7, head: { ref: 'change', repo: { full_name: 'owner/repo' } }, base: { repo: { full_name: 'owner/repo' } } }
  for (const candidates of [[pr], [pr, { ...pr, number: 8 }], [{ ...pr, head: { ref: 'different' } }],
    [{ ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } }], [{ ...pr, base: { repo: { full_name: 'other/repo' } } }]]) {
    const github = {
      rest: { actions: { listWorkflowRunsForRepo: 'runs', listJobsForWorkflowRun: 'jobs' }, repos: { listPullRequestsAssociatedWithCommit: 'prs' }, pulls: { list: 'pulls' } },
      async paginate(endpoint, args) {
        if (endpoint === 'runs') return [old, newer]
        if (endpoint === 'prs') return candidates
        if (endpoint === 'pulls') return []
        return [job(args.run_id === 1 ? 'failure' : 'success')]
      },
    }
    const evidence = await collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: new Date('2026-09-01T00:00:00Z'), recentJobLimit: 0 })
    const result = buildFailureRecovery(evidence)
    const matched = candidates.length === 1 && candidates[0] === pr
    assert.equal(result.recovered.length, matched ? 1 : 0)
    if (matched) assert.equal(result.recovered[0].run.pullRequests[0].number, 7)
    assert.equal(old.pull_requests.length, 0, 'API input must not be mutated')
  }
})

test('collector avoids the GitHub 1,000-run cap by subdividing and deduplicating inclusive time ranges', async () => {
  const start = new Date('2026-09-01T00:00:00Z')
  const end = new Date('2026-09-01T01:00:00Z')
  const source = Array.from({ length: 1201 }, (_, id) => run({ id, created_at: new Date(start.getTime() + id * 3000).toISOString() }))
  let calls = 0
  const github = {
    rest: { actions: { listWorkflowRunsForRepo: 'runs', listJobsForWorkflowRun: 'jobs' } },
    async paginate(endpoint, args) {
      assert.equal(endpoint, 'runs')
      calls++
      const [from, to] = args.created.split('..').map(Date.parse)
      return source.filter((run) => Date.parse(run.created_at) >= from && Date.parse(run.created_at) <= to).slice(0, 1000)
    },
  }
  const evidence = await collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: start, until: end, recentJobLimit: 0 })
  assert.equal(evidence.runs.length, 1201)
  assert.equal(new Set(evidence.runs.map(({ id }) => id)).size, 1201)
  assert.equal(calls, 3)
})

test('a saturated one-second API interval fails closed instead of claiming a complete window', async () => {
  const github = {
    rest: { actions: { listWorkflowRunsForRepo: 'runs' } },
    async paginate() { return Array.from({ length: 1000 }, () => run()) },
  }
  await assert.rejects(collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: new Date('2026-09-01T00:00:00Z'), until: new Date('2026-09-01T00:00:01Z') }), /full window evidence is unavailable/)
})

test('retired queue branches remain historical while existing failed queue contexts stay active', async () => {
  const failed = failure({ event: 'merge_group', head_branch: 'gh-readonly-queue/main/pr-7-source' })
  for (const status of [200, 404, 403]) {
    const github = {
      rest: { actions: { listWorkflowRunsForRepo: 'runs', listJobsForWorkflowRun: 'jobs' }, repos: {
        listPullRequestsAssociatedWithCommit: 'prs',
        async getBranch({ branch }) {
          assert.equal(branch, failed.head_branch)
          if (status !== 200) throw Object.assign(new Error('API response'), { status })
        },
      } },
      async paginate(endpoint) {
        if (endpoint === 'runs') return [failed]
        if (endpoint === 'prs') return []
        return [job('failure')]
      },
    }
    const collect = () => collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: new Date('2026-09-01T00:00:00Z') })
    if (status === 403) await assert.rejects(collect(), /API response/)
    else {
      const result = buildFailureRecovery(await collect())
      assert.equal(result.active.length, status === 200 ? 1 : 0)
      assert.equal(result.needsVerification.length, status === 404 ? 1 : 0)
      assert.equal(Object.hasOwn(failed, 'retiredMergeQueueContext'), false, 'API input must not be mutated')
    }
  }
})

test('rewritten PR commits use a unique head/repository and open-lifetime match; closed contexts are historical', async () => {
  const old = failure({ event: 'pull_request', head_repository: { full_name: 'owner/repo' } })
  const newer = later({ event: 'pull_request', head_repository: { full_name: 'owner/repo' } })
  const pr = { number: 7, state: 'closed', created_at: '2026-08-31T00:00:00Z', closed_at: '2026-09-02T00:00:00Z',
    head: { ref: 'change', repo: { full_name: 'owner/repo' } }, base: { repo: { full_name: 'owner/repo' } } }
  for (const candidates of [[pr], [pr, { ...pr, number: 8 }], [{ ...pr, closed_at: '2026-08-31T23:59:59Z' }],
    [{ ...pr, created_at: '2026-09-01T01:01:00Z' }], [{ ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } }]]) {
    let headLookups = 0
    const github = {
      rest: { actions: { listWorkflowRunsForRepo: 'runs', listJobsForWorkflowRun: 'jobs' }, repos: { listPullRequestsAssociatedWithCommit: 'prs' }, pulls: { list: 'pulls' } },
      async paginate(endpoint, args) {
        if (endpoint === 'runs') return [old, newer]
        if (endpoint === 'prs') return []
        if (endpoint === 'pulls') { headLookups++; assert.equal(args.head, 'owner:change'); return candidates }
        return [job(args.run_id === 1 ? 'failure' : 'success')]
      },
    }
    const evidence = await collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: new Date('2026-09-01T00:00:00Z') })
    const matched = candidates.length === 1 && candidates[0] === pr
    assert.equal(buildFailureRecovery(evidence).recovered.length, matched ? 1 : 0)
    assert.equal(headLookups, 1, 'head lookups must be cached')
    if (matched) {
      const historical = buildFailureRecovery({ ...evidence, runs: [evidence.runs.find((run) => run.id === 1)] })
      assert.equal(historical.active.length, 0)
      assert.equal(historical.needsVerification.length, 1)
      assert.match(historical.needsVerification[0].reason, /PR is closed/)
    }
  }
})

test('a missing rewritten commit can use verified PR lifetime; permission errors still fail closed', async () => {
  const failed = failure({ event: 'pull_request', head_repository: { full_name: 'owner/repo' } })
  const pr = { number: 7, state: 'closed', created_at: '2026-08-31T00:00:00Z', closed_at: '2026-09-02T00:00:00Z',
    head: { ref: 'change', repo: { full_name: 'owner/repo' } }, base: { repo: { full_name: 'owner/repo' } } }
  for (const status of [404, 403]) {
    const github = {
      rest: { actions: { listWorkflowRunsForRepo: 'runs', listJobsForWorkflowRun: 'jobs' }, repos: { listPullRequestsAssociatedWithCommit: 'prs' }, pulls: { list: 'pulls' } },
      async paginate(endpoint) {
        if (endpoint === 'runs') return [failed]
        if (endpoint === 'prs') throw Object.assign(new Error('Commit unavailable'), { status })
        if (endpoint === 'pulls') return [pr]
        return [job('failure')]
      },
    }
    const collect = () => collectCiObservabilityEvidence({ github, owner: 'owner', repo: 'repo', since: new Date('2026-09-01T00:00:00Z') })
    if (status === 403) await assert.rejects(collect(), /Commit unavailable/)
    else assert.equal((await collect()).runs[0].pull_requests[0].number, 7)
  }
})

test('issue limits details without truncating metrics or the full report artifact', () => {
  const report = buildCiObservabilityReport({ runs: Array.from({ length: 25 }, (_, index) => failure({ id: index + 1, workflow_id: index + 1 })) })
  const issue = renderCiSloIssueBody(report, 'https://github.com/owner/repo/actions/runs/999')
  assert.match(issue, /25 completed workflow/)
  assert.match(issue, /\*\*25 active\*\*/)
  assert.match(issue, /5 additional observation/)
  assert.equal((issue.match(/No later completed run/g) || []).length, 20)
  assert.equal((renderCiObservabilityMarkdown(report).match(/No later completed run/g) || []).length, 25)
})

test('large job matrices stay within the issue body budget while preserving counts and the artifact link', () => {
  const runs = Array.from({ length: 25 }, (_, index) => failure({ id: index + 1, workflow_id: index + 1 }))
  const jobsByRun = new Map(runs.map((run) => [run.id, Array.from({ length: 100 }, (_, index) => job('failure', { name: `Matrix job ${index}: ${'x'.repeat(200)}` }))]))
  const report = buildCiObservabilityReport({ runs, jobsByRun })
  const issue = renderCiSloIssueBody(report, 'https://github.com/owner/repo/actions/runs/999')
  assert.ok(Buffer.byteLength(issue) <= 60_000)
  assert.match(issue, /\*\*25 active\*\*/)
  assert.match(issue, /additional observation/)
  assert.match(issue, /\/actions\/runs\/999/)
  assert.equal(report.failureRecovery.active.length, 25)
})

test('untrusted workflow and job names cannot inject Markdown table cells or headings', () => {
  const report = buildCiObservabilityReport({
    runs: [failure({ name: 'CI | misleading\n# heading' })],
    jobsByRun: new Map([[1, [job('failure', { name: '[job] | cell' })]]]),
  })
  const markdown = renderCiObservabilityMarkdown(report)
  assert.ok(markdown.includes('CI \\| misleading # heading'))
  assert.ok(markdown.includes('\\[job\\] \\| cell'))
  assert.ok(!markdown.includes('\n# heading'))
})

test('scheduled workflow uses shared report/issue rendering and preserves threshold-driven closure', () => {
  const workflow = fs.readFileSync('.github/workflows/ci-cost-report.yml', 'utf8')
  assert.match(workflow, /collectCiObservabilityEvidence/)
  assert.match(workflow, /renderCiSloIssueBody/)
  assert.match(workflow, /ci-release-observability\.json/)
  assert.match(workflow, /evaluateCiSlo/)
  assert.match(workflow, /\[CI SLO\] Release pipeline threshold breach/)
  assert.match(workflow, /if: steps\.report\.outputs\.slo_status == 'met'/)
  assert.match(workflow, /state_reason: 'completed'/)
  assert.match(workflow, /cron: "30 4 \* \* \*"/)
  assert.doesNotMatch(workflow, /workflowId = 'ci\.yml'/)
})
