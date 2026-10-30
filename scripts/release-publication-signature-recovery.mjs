#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertSamePublication, createPublicationRecord } from './lib/release-publication-record.mjs'
import { validateSecurityProof } from './lib/release-publication-security.mjs'
import { verifyReceipt } from './release-candidate-receipt.mjs'

const repository = 'EnterpriseGlue/enterpriseglue-the-bridge-oss'
const signingStep = 'Persist the signed publication identity before creating any tag'
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

export function verifyUnsignedIdentityManifest(manifestBytes, recordBytes) {
  assert.ok(manifestBytes.length > 0 && manifestBytes.length <= 8192)
  assert.ok(recordBytes.length > 0 && recordBytes.length <= 128 * 1024)
  const text = new TextDecoder('utf-8', {fatal:true}).decode(manifestBytes).trim()
  const manifest = JSON.parse(text)
  assert.match(manifest.annotations?.['org.opencontainers.image.created'] || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  const expected = {schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',
    artifactType:'application/vnd.enterpriseglue.release-publication.v1',
    config:{mediaType:'application/vnd.oci.empty.v1+json',digest:'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',size:2,data:'e30='},
    layers:[{mediaType:'application/vnd.enterpriseglue.release-publication.v1+json',digest:digest(recordBytes),size:recordBytes.length,
      annotations:{'org.opencontainers.image.title':'publication.json'}}],annotations:manifest.annotations}
  assert.deepEqual(Object.keys(manifest.annotations),['org.opencontainers.image.created'])
  // Exact serialization also rejects duplicate JSON keys. No extra layers,
  // remote URLs, config payloads, path aliases or subjects may be signed.
  assert.equal(text,JSON.stringify(expected),'Unsigned OCI manifest differs from the closed original-record shape.')
}

// GitHub's authenticated artifact digest is the custody boundary. Registry
// contents are never a source of authorization, even if their identity matches.
export function verifyFailedIdentityArtifact({ run, jobs, artifact, archive, documents, proposed, candidate }) {
  assert.equal(run.status, 'completed')
  assert.equal(run.conclusion, 'failure')
  assert.equal(run.event, 'workflow_dispatch')
  assert.equal(run.path, '.github/workflows/release-please.yml')
  assert.equal(run.head_branch, 'main')
  assert.equal(run.head_repository.full_name, repository)
  assert.equal(run.head_sha, proposed.identity.sourceRef, 'Only the original frozen-source publication can supply repair bytes.')
  assert.equal(jobs.length, 1)
  const job = jobs[0]
  assert.equal(job.run_id, run.id)
  assert.equal(job.name, 'release-please')
  assert.equal(job.head_sha, run.head_sha)
  assert.equal(job.conclusion, 'failure')
  for (const [name, conclusion] of [
    ['Resolve release preparation or explicitly approved publication', 'success'],
    ['Verify signed candidate before tag creation', 'success'],
    ['Refresh security evidence for the exact frozen images', 'success'],
    [signingStep, 'failure'], ['Run Release Please', 'skipped'],
    ['Retain batch publication authorization', 'success'],
  ]) {
    const steps = job.steps.filter(step => step.name === name)
    assert.equal(steps.length, 1)
    assert.equal(steps[0].conclusion, conclusion, `Unexpected original step: ${name}`)
  }
  assert.equal(artifact.name, `release-publication-authorization-${run.id}`)
  assert.equal(artifact.expired, false)
  assert.equal(artifact.workflow_run.id, run.id)
  assert.equal(artifact.workflow_run.head_sha, run.head_sha)
  assert.ok(archive.length > 0 && archive.length <= 16 * 1024 * 1024)
  assert.equal(archive.length, artifact.size_in_bytes)
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(digest(archive), artifact.digest, 'GitHub artifact digest mismatch.')
  const authorization = JSON.parse(documents['authorization.json'])
  assert.deepEqual(Object.keys(authorization).sort(), ['schemaVersion', 'sourceRef', 'releaseTag', 'releasePR', 'requiredPRs', 'previousTag',
    'controlRef', 'recoveryPRs', 'documentation', 'requestedBy', 'workflowRun', 'publicationPerformed'].sort())
  assert.equal(authorization.schemaVersion, 1)
  assert.equal(authorization.publicationPerformed, false)
  assert.equal(authorization.controlRef, run.head_sha)
  assert.deepEqual(authorization.recoveryPRs, [])
  assert.equal(authorization.requestedBy, run.actor.login)
  assert.equal(authorization.workflowRun, String(run.id))
  const original = JSON.parse(documents['publication.json'])
  const expected = createPublicationRecord({ authorization, candidate, candidateRef: proposed.identity.candidateRef,
    dockerhubNamespace: proposed.identity.dockerhub.required ? proposed.identity.dockerhub.namespace : '' })
  // Fresh security is independently required; old scans are retained history.
  validateSecurityProof(proposed.security, candidate)
  expected.security = JSON.parse(documents['security/security.json'])
  assert.deepEqual(original, expected, 'Original artifact is not the independently reconstructed approved record.')
  assertSamePublication(original, proposed)
  assert.deepEqual(original.identity, proposed.identity)
  return Buffer.from(documents['publication.json'])
}

export function readIdentityArchive(archive) {
  // No extraction to disk, links, duplicate members or unrestricted expansion.
  const script = `import sys,io,zipfile,json,stat
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
items=z.infolist(); names=[i.filename for i in items]
assert len(items)<=32 and len(names)==len(set(names))
assert sum(i.file_size for i in items)<=32*1024*1024
for i in items:
 assert i.file_size<=8*1024*1024 and not i.flag_bits&1
 assert not i.filename.startswith('/') and all(p not in ('','.','..') for p in i.filename.split('/'))
 assert not stat.S_ISLNK(i.external_attr>>16)
required=['authorization.json','publication.json','security/security.json']
assert all(n in names for n in required)
assert all(z.getinfo(n).file_size<=128*1024 for n in required)
print(json.dumps({n:z.read(n).decode('utf-8','strict') for n in required}))`
  return JSON.parse(execFileSync('python3', ['-c', script], { input: archive, maxBuffer: 1024 * 1024, timeout: 10000 }))
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv[0] === 'verify-manifest') {
    assert.equal(argv.length,3)
    verifyUnsignedIdentityManifest(readFileSync(argv[1]),readFileSync(argv[2]))
    return
  }
  assert.equal(argv.length, 4, 'Expected original run, proposed record, candidate directory and exclusive output.')
  const [runId, proposedPath, candidateDirectory, output] = argv
  assert.match(runId, /^[1-9][0-9]{0,19}$/)
  assert.notEqual(runId, env.GITHUB_RUN_ID)
  assert.equal(env.GITHUB_REPOSITORY, repository)
  assert.equal(env.GITHUB_WORKFLOW, 'Release Please')
  assert.equal(env.GITHUB_REF, 'refs/heads/main')
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch')
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  assert.ok([true, 'true'].includes(event.inputs.publish_release))
  assert.equal(event.inputs.identity_signature_recovery_run, runId)
  const proposed = JSON.parse(readFileSync(proposedPath, 'utf8'))
  const authorization = JSON.parse(readFileSync('.artifacts/release-publication/authorization.json', 'utf8'))
  assert.equal(authorization.controlRef, env.GITHUB_SHA)
  assert.equal(authorization.workflowRun, env.GITHUB_RUN_ID)
  assertSamePublication(proposed, createPublicationRecord({ authorization,
    candidate: await verifyReceipt({ receipt: `${candidateDirectory}/release-candidate.json`, artifacts: candidateDirectory,
      'source-ref': authorization.sourceRef, 'release-tag': authorization.releaseTag }),
    candidateRef: proposed.identity.candidateRef,
    dockerhubNamespace: proposed.identity.dockerhub.required ? proposed.identity.dockerhub.namespace : '' }))
  const candidate = JSON.parse(readFileSync(`${candidateDirectory}/release-candidate.json`, 'utf8'))
  const api = (path, binary = false) => execFileSync('gh', ['api', `repos/${repository}/${path}`], {
    encoding: binary ? undefined : 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000 })
  const json = path => JSON.parse(api(path))
  const run = json(`actions/runs/${runId}`)
  assert.equal(String(run.id), runId)
  const jobs = json(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`)
  assert.equal(jobs.total_count, jobs.jobs.length)
  const artifacts = json(`actions/runs/${runId}/artifacts?per_page=100`)
  assert.equal(artifacts.total_count, artifacts.artifacts.length)
  const matches = artifacts.artifacts.filter(item => item.name === `release-publication-authorization-${runId}`)
  assert.equal(matches.length, 1)
  const artifact = matches[0]
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0)
  const archive = api(`actions/artifacts/${artifact.id}/zip`, true)
  // Verify custody before parsing even the bounded ZIP.
  assert.equal(digest(archive), artifact.digest)
  const bytes = verifyFailedIdentityArtifact({ run, jobs: jobs.jobs, artifact, archive,
    documents: readIdentityArchive(archive), proposed, candidate })
  for (const endpoint of [`git/ref/tags/${proposed.identity.releaseTag}`, `releases/tags/${proposed.identity.releaseTag}`]) {
    let absent = false
    try { api(endpoint) } catch (error) { absent = /\(HTTP 404\)/.test(String(error.stderr || '')) }
    assert.equal(absent, true, 'Signature repair requires both tag and GitHub release to be absent.')
  }
  assert.equal(json('git/ref/heads/main').object.sha, env.GITHUB_SHA)
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
  writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 })
  console.log('[release-publication] authenticated original pre-tag record retained; no registry write performed.')
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  main().catch(() => { console.error('[release-publication] Original identity custody could not be verified; no repair authorized.'); process.exitCode = 1 })
}
