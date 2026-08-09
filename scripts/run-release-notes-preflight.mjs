#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { main as runReleaseNotesCommand } from './release-notes.mjs'

function fail(message) {
  throw new Error(message)
}

export function parsePreflightArgs(argv) {
  const options = {
    baseRef: process.env.GITHUB_HEAD_REF?.startsWith('release-please--branches--')
      ? undefined
      : `origin/${process.env.GITHUB_BASE_REF || 'main'}`,
    output: '.artifacts/release-notes-preview.md',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (!value.startsWith('--')) fail(`Unexpected argument: ${value}`)
    const key = value.slice(2)
    if (key === 'skip-recommend') {
      options.skipRecommend = true
      continue
    }
    if (!['base-ref', 'release-base', 'output'].includes(key)) fail(`Unknown option: --${key}`)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) fail(`Missing value for --${key}`)
    options[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next
    index += 1
  }
  return options
}

export function latestStableTag(root = process.cwd()) {
  const tags = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\n').map((tag) => tag.trim()).filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  if (tags.length === 0) fail('No stable vX.Y.Z tag is available for release version recommendation.')
  return tags[0]
}

function defaultToolTests(root) {
  execFileSync(process.execPath, [
    '--test',
    'scripts/release-notes.test.mjs',
    'scripts/release-notes-preflight.test.mjs',
  ], { cwd: root, stdio: 'inherit' })
}

export function runPreflight({
  root = process.cwd(),
  baseRef,
  releaseBase,
  output = '.artifacts/release-notes-preview.md',
  skipRecommend = false,
  runToolTests = defaultToolTests,
  runCommand = (args) => runReleaseNotesCommand(args, root),
} = {}) {
  const stableTag = releaseBase || latestStableTag(root)
  const comparisonBase = baseRef || stableTag
  let failure

  try {
    runToolTests(root)
    runCommand(['baseline'])
    runCommand(['validate', '--base-ref', comparisonBase])
    if (!skipRecommend) runCommand(['recommend', '--base-ref', stableTag])
  } catch (error) {
    failure = error
  } finally {
    try {
      runCommand(['preview', '--base-ref', comparisonBase, '--output', output])
    } catch (previewError) {
      if (!failure) failure = previewError
      else console.error(`[release-notes-preflight] preview also failed: ${previewError.message}`)
    }
  }

  if (failure) throw failure
  console.log(`[release-notes-preflight] passed; preview=${output}`)
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const options = parsePreflightArgs(argv)
  runPreflight({ root, ...options })
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    main()
  } catch (error) {
    console.error(`[release-notes-preflight] ${error.message}`)
    process.exitCode = 1
  }
}
