import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

const parseVersion = (version) => {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/)
  assert.ok(match, `expected a stable semantic version, received ${version}`)
  return match.slice(1).map(Number)
}

const isAtLeast = (version, minimum) => {
  const actual = parseVersion(version)
  return actual.some((part, index) => (
    part > minimum[index] && actual.slice(0, index).every((value, prior) => value === minimum[prior])
  )) || actual.every((part, index) => part === minimum[index])
}

const isPatchedFastUri = (version) => {
  const [major, minor, patch] = parseVersion(version)
  const minimumByMajor = new Map([
    [2, [2, 4, 5]],
    [3, [3, 1, 6]],
    [4, [4, 1, 3]],
  ])
  const minimum = minimumByMajor.get(major)
  if (!minimum) return major > 4
  return isAtLeast(`${major}.${minor}.${patch}`, minimum)
}

test('fast-uri security override and lockfile stay on a patched release line', async () => {
  const [packageText, workspaceText, lockText] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('pnpm-workspace.yaml', root), 'utf8'),
    readFile(new URL('pnpm-lock.yaml', root), 'utf8'),
  ])
  const packageJson = JSON.parse(packageText)

  assert.equal(packageJson.overrides?.['fast-uri'], '^3.1.6')
  assert.equal(packageJson.overrides?.qs, '^6.16.0')
  assert.match(workspaceText, /^overrides:\n(?: {2}.+\n)* {2}fast-uri: \^3\.1\.6$/m)
  assert.match(workspaceText, /^overrides:\n(?: {2}.+\n)* {2}qs: \^6\.16\.0$/m)

  const lockedVersions = [...lockText.matchAll(/^ {2}fast-uri@(\d+\.\d+\.\d+):$/gm)]
    .map((match) => match[1])

  assert.ok(lockedVersions.length > 0, 'expected fast-uri to be represented in the lockfile')
  for (const version of lockedVersions) {
    assert.ok(isPatchedFastUri(version), `fast-uri ${version} is below its patched release floor`)
  }

  const lockedQsVersions = [...lockText.matchAll(/^ {2}qs@(\d+\.\d+\.\d+):$/gm)]
    .map((match) => match[1])
  assert.ok(lockedQsVersions.length > 0, 'expected qs to be represented in the lockfile')
  for (const version of lockedQsVersions) {
    assert.ok(isAtLeast(version, [6, 16, 0]), `qs ${version} is below 6.16.0`)
  }
})
