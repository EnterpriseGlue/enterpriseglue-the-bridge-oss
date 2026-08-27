import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateNeeds, renderSummary } from './evaluate-ci-needs.mjs'

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

for (const result of ['failure', 'cancelled', 'timed_out', 'action_required', '']) {
  test(`CI needs reject ${result || 'a missing result'}`, () => {
    const evaluation = evaluateNeeds({ unsafe: { result } })
    assert.equal(evaluation.passed, false)
    assert.deepEqual(evaluation.rejected, [{ job: 'unsafe', result }])
  })
}
