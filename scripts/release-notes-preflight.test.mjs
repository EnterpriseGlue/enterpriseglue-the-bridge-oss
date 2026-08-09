import assert from 'node:assert/strict'
import test from 'node:test'

import { parsePreflightArgs, runPreflight } from './run-release-notes-preflight.mjs'

test('preflight arguments select explicit comparison, release, and preview targets', () => {
  assert.deepEqual(
    parsePreflightArgs([
      '--base-ref', 'origin/trunk',
      '--release-base', 'v1.2.3',
      '--output', '.artifacts/custom.md',
    ]),
    {
      baseRef: 'origin/trunk',
      releaseBase: 'v1.2.3',
      output: '.artifacts/custom.md',
    },
  )
  assert.throws(() => parsePreflightArgs(['--unknown', 'value']), /Unknown option/)
  assert.equal(parsePreflightArgs(['--skip-recommend']).skipRecommend, true)
})

test('preflight runs one deterministic sequence and always builds the preview', () => {
  const calls = []
  runPreflight({
    root: '/repo',
    baseRef: 'origin/main',
    releaseBase: 'v0.10.5',
    output: '.artifacts/preview.md',
    runToolTests: (root) => calls.push(['tests', root]),
    runCommand: (args) => calls.push(args),
  })
  assert.deepEqual(calls, [
    ['tests', '/repo'],
    ['baseline'],
    ['validate', '--base-ref', 'origin/main'],
    ['recommend', '--base-ref', 'v0.10.5'],
    ['preview', '--base-ref', 'origin/main', '--output', '.artifacts/preview.md'],
  ])
})

test('preflight retains the primary failure after producing diagnostic preview', () => {
  const calls = []
  assert.throws(
    () => runPreflight({
      baseRef: 'origin/main',
      releaseBase: 'v0.10.5',
      runToolTests: () => {},
      runCommand: (args) => {
        calls.push(args[0])
        if (args[0] === 'validate') throw new Error('missing fragment')
      },
    }),
    /missing fragment/,
  )
  assert.deepEqual(calls, ['baseline', 'validate', 'preview'])
})

test('non-PR preflight can skip version recommendation while retaining validation', () => {
  const calls = []
  runPreflight({
    baseRef: 'origin/main',
    releaseBase: 'v0.10.5',
    skipRecommend: true,
    runToolTests: () => {},
    runCommand: (args) => calls.push(args[0]),
  })
  assert.deepEqual(calls, ['baseline', 'validate', 'preview'])
})
