import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runCanary, workflowStep } from './release-publication-canary.mjs'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const start = ci.indexOf('  release-authorization-canary:\n')
const job = ci.slice(start, ci.indexOf('  documentation-boundary:\n', start))

test('the pre-merge authorization canary has no publication credentials or write permissions', () => {
  assert.ok(start > 0)
  assert.match(job, /needs: detect\n\s+if: needs\.detect\.outputs\.workflow_or_release == 'true'/)
  assert.match(job, /timeout-minutes: 5/)
  assert.match(job, /contents: read\n\s+packages: read/)
  assert.doesNotMatch(job, /: write|secrets\.(?!GITHUB_TOKEN)|pull_request_target|id-token:/)
  assert.match(job, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(job, /persist-credentials: false/)
  assert.match(job, /node scripts\/release-publication-canary\.mjs --candidate-handoff/)
  assert.match(job, /name: release-authorization-canary-\$\{\{ github\.sha \}\}/)
  assert.match(job, /if-no-files-found: error/)
  assert.doesNotMatch(job, /release-please-action|npm publish|docker build|oras (?:push|cp)/)
  assert.match(ci.slice(ci.indexOf('  ci-complete:\n')), /      - release-authorization-canary\n/)
})

test('the canary uses the production approval and signed-candidate handoff, not a publisher', () => {
  assert.match(workflowStep('Resolve release preparation or explicitly approved publication'), /node scripts\/release-publication-approval\.mjs/)
  assert.match(workflowStep('Verify signed candidate before tag creation'), /bash scripts\/fetch-release-candidate\.sh "\$GITHUB_SHA" "\$RELEASE_TAG"/)
})

test('actual CLI fixture rehearsal is token-free and emits only supplemental non-publishing evidence', () => {
  const receipt = runCanary({ env: { PATH: process.env.PATH, GH_TOKEN: 'must-not-enter-fixtures', GITHUB_TOKEN: 'must-not-enter-fixtures' } })
  assert.equal(receipt.kind, 'release-authorization-canary')
  assert.equal(receipt.scenarios.length, 8)
  assert.equal(receipt.candidateCheckReached, false, 'Local offline proof cannot stand in for hosted candidate handoff.')
  for (const field of ['signedCandidateAccepted', 'publicationPerformed', 'productionTagsWritten', 'registryWritesPerformed']) {
    assert.equal(receipt[field], false)
  }
  assert.equal(receipt.fixtureApi, true)
  assert.equal(receipt.sourceHashes['.github/workflows/release-please.yml'], createHash('sha256')
    .update(readFileSync(new URL('../.github/workflows/release-please.yml', import.meta.url))).digest('hex'))
})
