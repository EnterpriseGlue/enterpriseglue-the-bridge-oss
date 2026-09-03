import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateNeeds, renderSummary, requiredJobsForSelection } from './evaluate-ci-needs.mjs'

test('CI needs accept only success and intentional skips', () => {
  const evaluation = evaluateNeeds({
    tests: { result: 'success', outputs: {} },
    optional: { result: 'skipped', outputs: {} },
  })
  assert.equal(evaluation.passed, true)
  assert.deepEqual(evaluation.rejected, [])
  assert.match(renderSummary(evaluation), /tests \| success/)
})

test('CI needs reject a skipped release-readiness job when it is required', () => {
  const evaluation = evaluateNeeds(
    { 'release-readiness': { result: 'skipped' } },
    { requiredNonSkippedJobs: ['release-readiness'] },
  )
  assert.equal(evaluation.passed, false)
  assert.deepEqual(evaluation.rejected, [{ job: 'release-readiness', result: 'skipped' }])
})

test('change classification makes every selected expensive lane non-skippable', () => {
  const required = requiredJobsForSelection({
    run_plugin_checks: 'true',
    run_tests: true,
    run_ci_images: 'false',
  })
  assert.deepEqual(required, [
    'plugin-api-compat-current',
    'plugin-api-compat-next',
    'plugin-platform',
    'test',
  ])

  const evaluation = evaluateNeeds({
    'plugin-api-compat-current': { result: 'success' },
    'plugin-api-compat-next': { result: 'success' },
    'plugin-platform': { result: 'skipped' },
    test: { result: 'success' },
  }, { requiredNonSkippedJobs: required })
  assert.equal(evaluation.passed, false)
  assert.deepEqual(evaluation.rejected, [{ job: 'plugin-platform', result: 'skipped' }])
})

test('documentation publication checks cannot be skipped on documentation changes', () => {
  const required = requiredJobsForSelection({ run_documentation_guard: 'true' })
  assert.deepEqual(required, ['documentation-boundary'])

  const evaluation = evaluateNeeds({
    'documentation-boundary': { result: 'skipped' },
  }, { requiredNonSkippedJobs: required })
  assert.equal(evaluation.passed, false)
})

for (const result of ['failure', 'cancelled', 'timed_out', 'action_required', '']) {
  test(`CI needs reject ${result || 'a missing result'}`, () => {
    const evaluation = evaluateNeeds({ unsafe: { result } })
    assert.equal(evaluation.passed, false)
    assert.deepEqual(evaluation.rejected, [{ job: 'unsafe', result }])
  })
}
