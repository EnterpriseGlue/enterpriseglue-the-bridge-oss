#!/usr/bin/env node
// Protected publication control only. This tool never signs or writes a registry.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as wait } from 'node:timers/promises'

const repository = 'EnterpriseGlue/enterpriseglue-the-bridge-oss'
const registry = 'ghcr.io/enterpriseglue/releases/enterpriseglue-oss-distribution'
const media = 'application/vnd.enterpriseglue.distribution-lock.v1+json'
const signer = 'https://github.com/' + repository + '/.github/workflows/plugin-toolchain-release.yml@refs/heads/main'
const chartNames = { runtimeChart: 'enterpriseglue-plugin-runtime', installerRbacChart: 'enterpriseglue-plugin-installer-rbac', managerChart: 'enterpriseglue-plugin-manager' }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const execute = promisify(execFile)
const command = async (name, args, timeout = 30000) => (await execute(name, args, { timeout, maxBuffer: 131072 })).stdout

export function selectOriginalReceipt(current, lock, candidate) {
  assert.equal(candidate.status, 'qualified')
  assert.equal(lock.schemaVersion, 'enterpriseglue-distribution-lock/v1')
  assert.equal(lock.sourceRevision, candidate.sourceRevision)
  assert.equal('v' + lock.version, candidate.releaseTag)
  for (const role of ['backend', 'frontend']) {
    assert.equal(lock.application[role].subject, candidate.subjects[role].subject)
    assert.deepEqual(lock.application[role].platforms, ['linux/amd64', 'linux/arm64'])
  }
  const original = lock.pluginToolchain
  for (const receipt of [current, original]) {
    assert.deepEqual(Object.keys(receipt).sort(), ['schemaVersion', 'version', 'sourceRevision', 'installer', 'managerVersion', 'manager', 'runtimeChart', 'installerRbacChart', 'managerChart', 'workflowRun', 'customerCiRequired', 'customerBuildRequired'].sort())
    assert.equal(receipt.schemaVersion, 'enterpriseglue-plugin-toolchain-release/v1')
    assert.equal(receipt.sourceRevision, candidate.sourceRevision)
    assert.match(receipt.workflowRun, /^https:\/\/github\.com\/EnterpriseGlue\/enterpriseglue-the-bridge-oss\/actions\/runs\/[1-9][0-9]{6,19}$/)
    assert.equal(receipt.customerCiRequired, false)
    assert.equal(receipt.customerBuildRequired, false)
    for (const [key, role] of [['installer', 'pluginInstaller'], ['manager', 'pluginManager']]) assert.equal(receipt[key], candidate.subjects[role].subject)
    for (const key of ['runtimeChart', 'installerRbacChart', 'managerChart']) {
      assert.deepEqual(Object.keys(receipt[key]).sort(), ['archiveSha256', 'subject'])
      const digest = candidate.subjects[key].subject.match(/@sha256:[a-f0-9]{64}$/)?.[0]
      assert.ok(digest)
      assert.equal(candidate.subjects[key].subject, 'ghcr.io/enterpriseglue/release-candidates/charts/' + candidate.sourceRevision + '/' + chartNames[key] + digest)
      assert.equal(receipt[key].subject, 'ghcr.io/enterpriseglue/charts/' + chartNames[key] + digest)
      assert.match(receipt[key].archiveSha256, /^[a-f0-9]{64}$/)
    }
  }
  const { workflowRun: currentRun, ...expected } = current
  const { workflowRun: originalRun, ...published } = original
  assert.deepEqual(published, expected, 'Published toolchain payload differs from the verified current candidate.')
  return structuredClone(original)
}

// Retry only the exact missing-signature read after a push. Invalid signatures,
// authorization failures and other registry errors fail on their first result.
export async function verifyDistributionSignature(subject, { run = command, pause = wait, now = Date.now } = {}) {
  assert.match(subject, /^ghcr\.io\/enterpriseglue\/releases\/enterpriseglue-oss-distribution@sha256:[a-f0-9]{64}$/)
  const deadline = now() + 30000
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      assert.ok(now() < deadline)
      await run('cosign', ['verify', '--certificate-identity', signer, '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', subject], deadline - now())
      return
    } catch (error) {
      const detail = String(error.stderr || '').trim()
      const missing = /^(?:Error: no signatures found\r?\n)?error during command execution: no signatures found$/.test(detail)
      if (!missing || attempt === 4 || now() >= deadline) throw error
      await pause(Math.min(250 * 2 ** attempt, Math.max(0, deadline - now())))
    }
  }
}

export async function resolveDistribution(tag, { run = command } = {}) {
  assert.match(tag, /^v[0-9]+\.[0-9]+\.[0-9]+$/)
  const reference = registry + ':' + tag
  let digest
  try { digest = (await run('oras', ['resolve', reference])).trim() }
  catch (error) {
    // Only a definite absent immutable version permits a first publication.
    if (String(error.stderr || '').trim() === 'Error response from registry: failed to resolve digest: ' + reference + ': not found') return null
    throw error
  }
  assert.match(digest, /^sha256:[a-f0-9]{64}$/)
  return digest
}

export async function retainedReceipt(current, candidate, { run = command, verify = verifyDistributionSignature } = {}) {
  assert.match(candidate.sourceRevision, /^[a-f0-9]{40}$/)
  assert.match(candidate.releaseTag, /^v[0-9]+\.[0-9]+\.[0-9]+$/)
  selectOriginalReceipt(current, { schemaVersion: 'enterpriseglue-distribution-lock/v1', sourceRevision: candidate.sourceRevision,
    version: candidate.releaseTag.slice(1), pluginToolchain: current,
    application: Object.fromEntries(['backend', 'frontend'].map(role => [role, {subject: candidate.subjects[role].subject, platforms: ['linux/amd64', 'linux/arm64']}])) }, candidate)
  const digest = await resolveDistribution(candidate.releaseTag, {run})
  if (digest === null) return structuredClone(current)
  const subject = registry + '@' + digest
  await verify(subject)
  const raw = await run('oras', ['manifest', 'fetch', subject])
  assert.equal('sha256:' + hash(raw), digest)
  const layers = JSON.parse(raw).layers.filter(value => value.mediaType === media)
  assert.equal(layers.length, 1)
  const layer = layers[0]
  assert.match(layer.digest, /^sha256:[a-f0-9]{64}$/)
  assert.ok(Number.isSafeInteger(layer.size) && layer.size > 0 && layer.size <= 131072)
  const bytes = await run('oras', ['blob', 'fetch', '--output', '-', registry + '@' + layer.digest])
  assert.equal(Buffer.byteLength(bytes), layer.size)
  assert.equal('sha256:' + hash(bytes), layer.digest)
  return selectOriginalReceipt(current, JSON.parse(bytes), candidate)
}

async function main(args) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.GITHUB_REPOSITORY, repository)
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
  assert.equal(process.env.GITHUB_WORKFLOW_REF, repository + '/.github/workflows/plugin-toolchain-release.yml@refs/heads/main')
  assert.match(process.env.GITHUB_WORKFLOW_SHA || '', /^[a-f0-9]{40}$/)
  if (args[0] === 'resolve-distribution') {
    assert.equal(args.length, 2)
    console.log(await resolveDistribution(args[1]) || 'absent')
  } else if (args[0] === 'verify-signature') {
    assert.equal(args.length, 2)
    await verifyDistributionSignature(args[1])
  } else {
    assert.equal(args[0], 'select'); assert.equal(args.length, 4)
    const read = async file => { const bytes = await readFile(file); assert.ok(bytes.length <= 131072); return JSON.parse(bytes) }
    const current = await read(args[1]), candidate = await read(args[3])
    const selected = await retainedReceipt(current, candidate)
    await writeFile(args[2], JSON.stringify(selected, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ selected: selected.workflowRun === current.workflowRun ? 'current' : 'authenticated-original', originalWorkflowRun: selected.workflowRun, currentWorkflowRun: current.workflowRun, registryWrites: 0 }))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { console.error('[release-publication] toolchain receipt or signature unverified'); process.exitCode = 1 })
}
