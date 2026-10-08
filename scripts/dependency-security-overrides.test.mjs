import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createRequire } from 'node:module'

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
    [2, [2, 4, 7]],
    [3, [3, 1, 8]],
    [4, [4, 1, 5]],
  ])
  const minimum = minimumByMajor.get(major)
  if (!minimum) return major > 4
  return isAtLeast(`${major}.${minor}.${patch}`, minimum)
}

test('request logging stays patched and vulnerable archive reader cannot return', async () => {
  const lockText = await readFile(new URL('pnpm-lock.yaml', root), 'utf8')
  const versions = [...lockText.matchAll(/^ {2}morgan@(\d+\.\d+\.\d+):$/gm)].map(match => match[1])
  assert.ok(versions.length > 0, 'expected the request logger in the lockfile')
  for (const version of versions) assert.ok(isAtLeast(version, [1, 12, 1]), `morgan ${version} is below the security floor`)
  assert.doesNotMatch(lockText, /adm-zip/, 'vulnerable ZIP dependency must not return, including transitively')
  for (const name of ['backend', 'packages/shared', 'packages/backend-host']) {
    const manifest = JSON.parse(await readFile(new URL(`${name}/package.json`, root), 'utf8'))
    assert.equal(manifest.dependencies?.['adm-zip'], undefined)
  }
})

test('fast-uri security override and lockfile stay on a patched release line', async () => {
  const [packageText, workspaceText, lockText] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('pnpm-workspace.yaml', root), 'utf8'),
    readFile(new URL('pnpm-lock.yaml', root), 'utf8'),
  ])
  const packageJson = JSON.parse(packageText)

  assert.equal(packageJson.overrides?.['fast-uri'], '^3.1.8')
  assert.equal(packageJson.overrides?.qs, '^6.16.0')
  assert.match(workspaceText, /^overrides:\n(?: {2}.+\n)* {2}fast-uri: \^3\.1\.8$/m)
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

test('approved mail/Git upgrades and compatible runtime dependencies cannot regress below reviewed security floors', async () => {
  const lockText = await readFile(new URL('pnpm-lock.yaml', root), 'utf8')
  const floors = {
    '@grpc/grpc-js': [1, 14, 5],
    '@simple-git/argv-parser': [2, 0, 1],
    'ip-address': [10, 7, 1],
    nodemailer: [10, 0, 16],
    'proxy-addr': [2, 0, 8],
    'simple-git': [4, 0, 2],
    'source-map-js': [1, 2, 2],
    undici: [7, 29, 1],
  }
  for (const [name, minimum] of Object.entries(floors)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const versions = [...lockText.matchAll(new RegExp("^ {2}'?" + escaped + '@(\\d+\\.\\d+\\.\\d+)', 'gm'))].map(match => match[1])
    assert.ok(versions.length > 0, 'missing locked ' + name)
    for (const version of versions) assert.ok(isAtLeast(version, minimum), name + ' ' + version + ' regressed')
  }
  for (const version of [...lockText.matchAll(/^ {2}brace-expansion@(\d+\.\d+\.\d+):$/gm)].map(match => match[1])) {
    const [major] = parseVersion(version)
    assert.ok(isAtLeast(version, major === 2 ? [2, 1, 7] : [5, 0, 12]), 'brace-expansion ' + version + ' regressed')
  }
})

test('Nodemailer uses the real major-version transport and envelope API without network delivery', async () => {
  const requireShared = createRequire(new URL('packages/shared/package.json', root))
  const nodemailer = requireShared('nodemailer')
  const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix'})
  try {
    const result = await transport.sendMail({
      from: 'EnterpriseGlue <sender@example.invalid>', to: 'recipient@example.invalid',
      subject: 'Upgrade compatibility', text: 'Local transport only',
    })
    assert.equal(typeof result.messageId, 'string')
    assert.deepEqual(result.envelope.to, ['recipient@example.invalid'])
    assert.ok(Buffer.isBuffer(result.message))
    assert.match(result.message.toString('utf8'), /Subject: Upgrade compatibility/)
    assert.match(result.message.toString('utf8'), /Local transport only/)
  } finally {
    transport.close()
  }
})

test('simple-git exposes the supported named factory and real read-only version command', async () => {
  const requireRoot = createRequire(new URL('package.json', root))
  const { simpleGit } = requireRoot('simple-git')
  assert.equal(typeof simpleGit, 'function')
  const result = await simpleGit().version()
  assert.ok(Number.isInteger(result.major) && result.major >= 2)
})

test('production dependency assembly excludes build dependencies without altering the build stage', async () => {
  const dockerfile = await readFile(new URL('backend/Dockerfile.prod', root), 'utf8')
  const build = dockerfile.slice(0, dockerfile.indexOf(' AS deps'))
  const deps = dockerfile.slice(dockerfile.indexOf(' AS deps'), dockerfile.indexOf(' AS runtime-root'))
  assert.match(build, /pnpm install --frozen-lockfile --filter webmodeler-backend\.\.\./)
  assert.doesNotMatch(build, /pnpm install --prod/)
  assert.match(deps, /pnpm install --prod --frozen-lockfile --filter webmodeler-backend\.\.\./)
  assert.match(dockerfile, /COPY --from=deps \/repo\/packages\/shared\/node_modules/)
})
