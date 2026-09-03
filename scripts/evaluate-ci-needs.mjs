#!/usr/bin/env node

import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const acceptedResults = new Set(['success', 'skipped'])

const selectedJobMap = new Map([
  ['run_documentation_guard', ['documentation-boundary']],
  ['run_boundary_guards', ['boundary-guards']],
  ['run_plugin_checks', ['plugin-platform', 'plugin-api-compat-current', 'plugin-api-compat-next']],
  ['run_plugin_images', ['plugin-platform-images']],
  ['run_package_discipline', ['published-package-version-discipline']],
  ['run_plugin_package', ['plugin-api-package']],
  ['run_compose_render', ['compose-render']],
  ['run_tests', ['test']],
  ['run_ci_images', ['build-ci-images']],
  ['run_smoke', ['smoke-postgres-image-deploy']],
  ['run_smoke_exposed', ['smoke-postgres-image-deploy-exposed']],
  ['run_security_scan', ['security-pr-scan']],
  ['run_native_tenancy', ['native-tenancy-pooled-e2e', 'saas-upgrade-restore-rollback']],
])

export function requiredJobsForSelection(selection) {
  assert.ok(selection && typeof selection === 'object' && !Array.isArray(selection), 'selection must be an object')
  const required = new Set()
  for (const [output, jobs] of selectedJobMap) {
    if (selection[output] === true || selection[output] === 'true') {
      for (const job of jobs) required.add(job)
    }
  }
  return [...required].sort()
}

export function evaluateNeeds(needs, { requiredNonSkippedJobs = [] } = {}) {
  assert.ok(needs && typeof needs === 'object' && !Array.isArray(needs), 'needs must be an object')
  const required = new Set(requiredNonSkippedJobs)
  const jobs = Object.entries(needs)
    .map(([job, value]) => ({ job, result: String(value?.result || '') }))
    .sort((left, right) => left.job.localeCompare(right.job))

  assert.ok(jobs.length > 0, 'needs must contain at least one job')
  const rejected = jobs.filter(({ job, result }) => (
    !acceptedResults.has(result) || (required.has(job) && result === 'skipped')
  ))
  for (const job of required) {
    assert.ok(jobs.some((entry) => entry.job === job), `required job is missing from needs: ${job}`)
  }
  return { jobs, rejected, passed: rejected.length === 0, requiredJobs: [...required].sort() }
}

export function renderSummary(evaluation) {
  const lines = [
    '## CI aggregate',
    '',
    '| Job | Result |',
    '| --- | --- |',
    ...evaluation.jobs.map(({ job, result }) => `| ${job} | ${result || 'missing'} |`),
    '',
    `Selected non-skippable jobs: ${evaluation.requiredJobs.join(', ') || 'none'}`,
    '',
    evaluation.passed
      ? 'All required CI jobs succeeded or were intentionally skipped.'
      : `Rejected results: ${evaluation.rejected.map(({ job, result }) => `${job}=${result || 'missing'}`).join(', ')}`,
    '',
  ]
  return lines.join('\n')
}

async function main() {
  const rawNeeds = process.env.CI_NEEDS_JSON || ''
  assert.ok(rawNeeds, 'CI_NEEDS_JSON is required')
  const requiredNonSkippedJobs = String(process.env.CI_REQUIRED_NON_SKIPPED_JOBS || '')
    .split(',')
    .map((job) => job.trim())
    .filter(Boolean)
  const selection = process.env.CI_SELECTION_JSON
    ? JSON.parse(process.env.CI_SELECTION_JSON)
    : {}
  requiredNonSkippedJobs.push(...requiredJobsForSelection(selection))
  const evaluation = evaluateNeeds(JSON.parse(rawNeeds), { requiredNonSkippedJobs })
  const summary = renderSummary(evaluation)
  process.stdout.write(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8')
  }
  if (!evaluation.passed) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
