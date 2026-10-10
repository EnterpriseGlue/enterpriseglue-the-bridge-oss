#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCanaryFixture } from './lib/release-publication-canary-fixture.mjs'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const workflow = readFileSync(join(sourceRoot, '.github/workflows/release-please.yml'), 'utf8')

export function workflowStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`)
  assert.ok(start >= 0, `Missing production step: ${name}`)
  const next = workflow.indexOf('\n      - name:', start + 1)
  return workflow.slice(start, next < 0 ? undefined : next)
}

export function runCanary({ candidateHandoff = false, env = process.env } = {}) {
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
  const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim() !== ''
  const output = join(sourceRoot, '.artifacts/release-publication-canary')
  rmSync(output, { recursive: true, force: true })
  if (env.GITHUB_SHA) {
    assert.equal(sourceRevision, env.GITHUB_SHA, 'Canary checkout must match the immutable workflow revision.')
    assert.equal(sourceDirty, false, 'Hosted canary requires a clean exact source checkout.')
  }
  const gate = workflowStep('Resolve release preparation or explicitly approved publication')
  assert.match(gate, /run: node scripts\/release-publication-approval\.mjs/)
  const candidate = workflowStep('Verify signed candidate before tag creation')
  assert.match(candidate, /if: steps\.publication\.outputs\.is_release == 'true'/)
  const publish = workflowStep('Run Release Please')
  assert.match(publish, /skip-github-release: \$\{\{ steps\.publication\.outputs\.is_release != 'true' \}\}/)
  assert.ok(workflow.indexOf(candidate) < workflow.indexOf(publish), 'Candidate verification must precede publication.')
  const f = createCanaryFixture()
  try {
    chmodSync(join(f.root, '.artifacts/bin/gh'), 0o700)
    // No caller tokens, credential files or production API adapter enter the
    // fixture subprocess. Its gh accepts only fixed fixture GET endpoints.
    const childEnv = { PATH: `${join(f.root, '.artifacts/bin')}${delimiter}${env.PATH}`,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GITHUB_REF: 'refs/heads/main', GITHUB_SHA: f.sha, GITHUB_REPOSITORY: f.repository,
      GITHUB_ACTOR: 'fixture-only', GITHUB_RUN_ID: 'fixture-only',
      GITHUB_EVENT_PATH: join(f.root, '.artifacts/event.json'), GITHUB_OUTPUT: join(f.root, '.artifacts/outputs'),
      CANARY_API_FILE: join(f.root, '.artifacts/api.json'), CANARY_API_TRACE: join(f.root, '.artifacts/api-trace') }
    const execute = (inputs, eventName = 'workflow_dispatch') => {
      f.write('.artifacts/event.json', JSON.stringify({ inputs }))
      rmSync(childEnv.GITHUB_OUTPUT, { force: true })
      rmSync(join(f.root, '.artifacts/release-publication'), { recursive: true, force: true })
      return spawnSync(process.execPath, [join(sourceRoot, 'scripts/release-publication-approval.mjs')], {
        cwd: f.root, env: { ...childEnv, GITHUB_EVENT_NAME: eventName }, encoding: 'utf8', timeout: 30000,
      })
    }
    const scenarios = []
    for (const event of ['push', 'schedule']) {
      const result = execute({}, event)
      assert.equal(result.status, 0, result.stderr)
      assert.match(readFileSync(childEnv.GITHUB_OUTPUT, 'utf8'), /is_release=false\n/)
      assert.equal(existsSync(childEnv.CANARY_API_TRACE), false, 'Automatic runs must not request fixture publication authority.')
      scenarios.push(`${event}-cannot-publish`)
    }
    const reject = (name, inputs, message) => {
      const result = execute(inputs)
      assert.equal(result.status, 1, `Expected rejection: ${name}`)
      assert.match(result.stderr, message)
      assert.equal(existsSync(childEnv.GITHUB_OUTPUT), false, 'Rejected approval must emit no publication outputs.')
      assert.equal(existsSync(join(f.root, '.artifacts/release-publication/authorization.json')), false)
      scenarios.push(name)
    }
    for (const event of ['push', 'schedule']) {
      const result = execute(f.inputs, event)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Automatic events cannot authorize/)
      assert.equal(existsSync(childEnv.GITHUB_OUTPUT), false)
      scenarios.push(`${event}-rejects-publication-inputs`)
    }
    reject('incomplete-batch', { ...f.inputs, required_prs: '[551]' }, /complete unreleased merged-PR batch/)
    const apiPath = '.artifacts/api.json'
    f.write(apiPath, JSON.stringify({ ...f.api, [`${f.prefix}git/ref/heads/main`]: [{ object: { sha: 'b'.repeat(40) } }] }))
    reject('source-drift', f.inputs, /Protected main moved/)
    f.write(apiPath, JSON.stringify({ ...f.api, [`${f.prefix}issues/900/comments`]: [[{ body: '<!-- enterpriseglue-detailed-release-notes -->\nMismatch' }]] }))
    reject('documentation-mismatch', f.inputs, /match.*exactly/)
    f.write(apiPath, JSON.stringify(f.api))
    const accepted = execute(f.inputs)
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.match(readFileSync(childEnv.GITHUB_OUTPUT, 'utf8'), /is_release=true\n/)
    const fixtureReceipt = JSON.parse(readFileSync(join(f.root, '.artifacts/release-publication/authorization.json'), 'utf8'))
    assert.equal(fixtureReceipt.publicationPerformed, false)
    assert.deepEqual(fixtureReceipt.requiredPRs, [551, 552])
    scenarios.push('complete-approval-reaches-candidate-gate')
    const frozen = join(f.root, '.artifacts/frozen-source')
    execFileSync('git', ['clone', '--quiet', '--shared', f.root, frozen])
    f.write('.github/workflows/release-please.yml', 'name: fixture-reviewed-repair\n')
    f.git(['add', '.github/workflows/release-please.yml']); f.git(['commit', '-m', 'fix(release): fixture publication repair'])
    const repaired = f.git(['rev-parse', 'HEAD'])
    const repair = {number:901,merged_at:'2026-10-10T00:00:00Z',merge_commit_sha:repaired,
      base:{ref:'main',repo:{full_name:f.repository}},head:{ref:'fix/fixture-repair',repo:{full_name:f.repository}}}
    const repairApi = {...f.api,[`${f.prefix}git/ref/heads/main`]:[{object:{sha:repaired}}],
      [`${f.prefix}commits/${repaired}/pulls?per_page=100`]:[[repair]]}
    f.write(apiPath,JSON.stringify(repairApi))
    childEnv.GITHUB_SHA = repaired
    childEnv.RELEASE_SOURCE_ROOT = frozen
    reject('unreviewed-workflow-repair', f.inputs, /requires an explicit recovery_prs/)
    const recovered = execute({...f.inputs,recovery_prs:'[901]'})
    assert.equal(recovered.status,0,recovered.stderr)
    const recoveryReceipt=JSON.parse(readFileSync(join(f.root,'.artifacts/release-publication/authorization.json'),'utf8'))
    assert.equal(recoveryReceipt.sourceRef,f.sha)
    assert.equal(recoveryReceipt.controlRef,repaired)
    assert.deepEqual(recoveryReceipt.recoveryPRs,[901])
    scenarios.push('reviewed-repair-preserves-frozen-candidate')
    f.write('backend/runtime.mjs','export const changedApplication = true\n')
    f.git(['add','backend/runtime.mjs']);f.git(['commit','-m','fix: fixture application change'])
    const changed=f.git(['rev-parse','HEAD'])
    childEnv.GITHUB_SHA=changed
    f.write(apiPath,JSON.stringify({...repairApi,[`${f.prefix}git/ref/heads/main`]:[{object:{sha:changed}}],
      [`${f.prefix}commits/${changed}/pulls?per_page=100`]:[[{...repair,number:902,merge_commit_sha:changed}]]}))
    reject('application-drift-is-not-a-workflow-repair',{...f.inputs,recovery_prs:'[901,902]'},/changes release content or an unallowlisted path/)
    let candidateCheckReached = false
    if (candidateHandoff) {
      // Execute the production shell body and actual candidate verifier. A
      // fresh random fixture commit cannot have a staged candidate. Verify its
      // missing manifest rejection, not an auth/tool/transport failure.
      const run = candidate.slice(candidate.indexOf('        run: |\n') + '        run: |\n'.length)
        .split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n')
      assert.match(run, /bash scripts\/fetch-release-candidate\.sh "\$SOURCE_REF" "\$RELEASE_TAG"/)
      const result = spawnSync('bash', ['-c', run], { cwd: sourceRoot, encoding: 'utf8', timeout: 60000,
        env: { PATH: env.PATH, HOME: env.HOME, DOCKER_CONFIG: env.DOCKER_CONFIG || `${env.HOME}/.docker`,
          RUNNER_TEMP: join(f.root, '.artifacts'), GITHUB_SHA: f.sha, SOURCE_REF: f.sha, RELEASE_TAG: 'v0.29.4',
          GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: f.repository } })
      assert.equal(result.status, 1, 'Missing fixture candidate must fail before any publisher can run.')
      assert.match(result.stderr, /(?:manifest unknown|MANIFEST_UNKNOWN|not found)/i,
        'Candidate handoff failed for an unexpected reason; do not count it as proof.')
      candidateCheckReached = true
      scenarios.push('actual-candidate-verifier-rejects-missing-fixture')
    }
    assert.equal(f.git(['tag', '--list']), 'v0.29.3', 'The fixture must create no new release tags.')
    assert.equal(f.git(['remote']), '', 'Fixture must have no push destination.')
    const receipt = { schemaVersion: 1, kind: 'release-authorization-canary', sourceRevision, sourceDirty,
      runId: env.GITHUB_RUN_ID || null, runAttempt: env.GITHUB_RUN_ATTEMPT || null,
      scenarios, candidateCheckReached, fixtureApi: true, signedCandidateAccepted: false,
      publicationPerformed: false, productionTagsWritten: false, registryWritesPerformed: false,
      sourceHashes: Object.fromEntries(['.github/workflows/release-please.yml', 'scripts/release-publication-approval.mjs',
        'scripts/lib/release-publication-policy.mjs'].map(file => [file, createHash('sha256').update(readFileSync(join(sourceRoot, file))).digest('hex')])) }
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
    console.log(`[release-authorization-canary] ${scenarios.length} scenarios passed; publicationPerformed=false; candidateCheckReached=${candidateCheckReached}`)
    return receipt
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  assert.ok(process.argv.slice(2).every(arg => arg === '--candidate-handoff'), 'Unknown canary argument.')
  runCanary({ candidateHandoff: process.argv.includes('--candidate-handoff') })
}
