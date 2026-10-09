import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { detailedNotesMarker, resolveReleasePublication, validateReleasePublicationApproval } from './lib/release-publication-policy.mjs'

const sha = 'a'.repeat(40)
const repository = 'EnterpriseGlue/enterpriseglue-the-bridge-oss'
const approvedInputs = { publish_release: true, source_ref: sha, release_tag: 'v0.30.0', release_pr: '900', required_prs: '[551,554]' }
const publicationContext = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha,
  commitMessage: 'chore(main)!: release 0.30.0', manifestVersion: '0.30.0', latestTag: 'v0.29.3', inputs: approvedInputs }

for (const eventName of ['push', 'schedule', 'workflow_run', 'pull_request']) {
  test(`${eventName} cannot publish even when the main commit is a release merge`, () => {
    const held = resolveReleasePublication({ ...publicationContext, eventName, inputs: {} })
    assert.equal(held.shouldPublish, false)
    assert.equal(held.shouldPrepare, false)
    assert.equal(held.mode, 'await-publication')
    assert.throws(() => resolveReleasePublication({ ...publicationContext, eventName }), /Automatic events cannot authorize/)
  })
}

test('ordinary merged code updates one pending release PR without publishing', () => {
  const result = resolveReleasePublication({ ...publicationContext, eventName: 'push', manifestVersion: '0.29.3',
    commitMessage: 'fix(runtime): restore upgrades', inputs: {} })
  assert.equal(result.shouldPrepare, true)
  assert.equal(result.shouldPublish, false)
})

test('manual preparation is non-publishing by default and cannot silently accept publication identities', () => {
  assert.equal(resolveReleasePublication({ ...publicationContext, inputs: { publish_release: false } }).shouldPublish, false)
  assert.throws(() => resolveReleasePublication({ ...publicationContext, inputs: { ...approvedInputs, publish_release: false } }), /Publication identity requires/)
  assert.throws(() => resolveReleasePublication({ ...publicationContext, inputs: { ...approvedInputs, publish_release: 'yes' } }), /must be a boolean/)
})

test('an explicit dispatch binds one release identity and a multi-PR batch', () => {
  const result = resolveReleasePublication(publicationContext)
  assert.equal(result.shouldPublish, true)
  assert.equal(result.shouldPrepare, false)
  assert.deepEqual(result.requiredPRs, [551, 554])
  assert.equal(result.sourceRef, sha)
})

for (const [name, change, error] of [
  ['source drift', { source_ref: 'b'.repeat(40) }, /Approved source_ref/],
  ['wrong tag', { release_tag: 'v0.31.0' }, /must agree/],
  ['missing release PR', { release_pr: '' }, /PR number/],
  ['empty batch', { required_prs: '[]' }, /non-empty/],
  ['duplicate PR', { required_prs: '[551,551]' }, /unique/],
  ['release PR in code batch', { required_prs: '[900]' }, /exclude/],
  ['invalid batch JSON', { required_prs: '551,554' }, /JSON array/],
]) {
  test(`publication rejects ${name}`, () => assert.throws(() => resolveReleasePublication({ ...publicationContext,
    inputs: { ...approvedInputs, ...change } }), error))
}

test('publication rejects an unprotected branch and an ordinary code commit', () => {
  assert.throws(() => resolveReleasePublication({ ...publicationContext, ref: 'refs/heads/fix/example' }), /protected main/)
  assert.throws(() => resolveReleasePublication({ ...publicationContext, commitMessage: 'fix: ordinary code' }), /must agree/)
})

function approvalFixture() {
  const releaseDocument = '---\ndoc_class: technical\n---\n\n# EnterpriseGlue v0.30.0 Release Notes\n\nBoth fixes and upgrade instructions.\n'
  const base = { ref: 'main', repo: { full_name: repository } }
  return { approval: resolveReleasePublication(publicationContext), repository,
    releasePR: { number: 900, state: 'closed', merged: true, merge_commit_sha: sha,
      title: 'chore(main): release 0.30.0', base, head: { ref: 'release-please--branches--main', repo: { full_name: repository } } },
    codePRs: [551, 554].map(number => ({ number, state: 'closed', merged: true, base, merge_commit_sha: 'b'.repeat(40) })),
    includedPRs: new Set([551, 554]), releaseDocument,
    managedComments: [`${detailedNotesMarker}\n\n${releaseDocument}`] }
}

test('the complete merged batch and exact generated managed document are accepted', () => {
  const fixture = approvalFixture()
  assert.equal(validateReleasePublicationApproval(fixture), fixture.approval)
})

for (const [name, mutate, error] of [
  ['unmerged code PR', f => { f.codePRs[0].merged = false }, /not merged/],
  ['missing required PR', f => { f.includedPRs.delete(554) }, /absent/],
  ['release source drift', f => { f.releasePR.merge_commit_sha = 'c'.repeat(40) }, /merge identity/],
  ['foreign release PR', f => { f.releasePR.head.repo.full_name = 'other/repository' }, /repository-owned/],
  ['wrong release version', f => { f.releasePR.title = 'chore(main): release 0.31.0' }, /approved version/],
  ['stale release comment', f => { f.managedComments[0] += '\nStale extra text.' }, /match.*exactly/],
  ['duplicate managed comments', f => { f.managedComments.push(f.managedComments[0]) }, /match.*exactly/],
  ['wrong document version', f => { f.releaseDocument = f.releaseDocument.replace('v0.30.0', 'v0.31.0') }, /document/],
]) {
  test(`batch approval rejects ${name}`, () => {
    const fixture = approvalFixture()
    mutate(fixture)
    assert.throws(() => validateReleasePublicationApproval(fixture), error)
  })
}

function githubScript(file, stepName) {
  const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')
  const start = source.indexOf(`      - name: ${stepName}\n`)
  assert.ok(start >= 0, stepName)
  const next = source.indexOf('\n      - name:', start + 1)
  const step = source.slice(start, next < 0 ? undefined : next)
  const scriptStart = step.indexOf('          script: |\n')
  assert.ok(scriptStart >= 0)
  return step.slice(scriptStart + '          script: |\n'.length).split('\n')
    .filter(line => line.startsWith('            ') || line === '').map(line => line.slice(12)).join('\n')
}

async function eligibility(file, stepName, pull) {
  const outputs = {}
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction('context', 'core', 'process', githubScript(file, stepName))(
    { payload: { pull_request: pull } }, { setOutput: (key, value) => { outputs[key] = value }, notice() {} },
    { env: { AI_AUTOPILOT_ENABLED: 'true', RELEASE_AUTOPILOT_ENABLED: 'true', ALLOWED_AUTHOR: 'haryselman' } },
  )
  return outputs.should_enable
}

test('actual autopilot and label workflows reject release PRs even with legacy flags enabled', async () => {
  const release = { number: 900, draft: false, user: { login: 'haryselman' }, head: { ref: 'release-please--branches--main' },
    title: 'chore(main): release 0.30.0', labels: [{ name: 'auto-merge' }, { name: 'release:fix' }] }
  assert.equal(await eligibility('release-autopilot-reusable.yml', 'Evaluate autopilot eligibility', release), 'false')
  assert.equal(await eligibility('auto-merge-label.yml', 'Check auto-merge label', release), 'false')
  const renamed = { ...release, head: { ref: 'other-name' }, labels: [...release.labels, { name: 'autorelease: pending' }] }
  assert.equal(await eligibility('release-autopilot-reusable.yml', 'Evaluate autopilot eligibility', renamed), 'false')
  assert.equal(await eligibility('auto-merge-label.yml', 'Check auto-merge label', renamed), 'false')
})

test('authorized code PR auto-merge remains available', async () => {
  const code = { number: 901, draft: false, user: { login: 'haryselman' }, head: { ref: 'fix/example' },
    title: 'fix: example', labels: [{ name: 'auto-merge' }, { name: 'release:fix' }] }
  assert.equal(await eligibility('release-autopilot-reusable.yml', 'Evaluate autopilot eligibility', code), 'true')
  assert.equal(await eligibility('auto-merge-label.yml', 'Check auto-merge label', code), 'true')
})

test('actual publication verification accepts only the approved tag source', async () => {
  const script = githubScript('release-please.yml', 'Verify release exists for merged release commit')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const execute = async tagSha => new AsyncFunction('context', 'core', 'process', 'github', script)(
    { repo: { owner: 'EnterpriseGlue', repo: 'enterpriseglue-the-bridge-oss' } },
    { notice() {}, setFailed(message) { throw new Error(message) } },
    { env: { APPROVED_SOURCE_REF: sha, APPROVED_RELEASE_TAG: 'v0.30.0' } },
    { rest: { git: { async getRef(input) { assert.equal(input.ref, 'tags/v0.30.0'); return { data: { object: { type: 'commit', sha: tagSha } } } } },
      repos: { async getReleaseByTag(input) { assert.equal(input.tag, 'v0.30.0'); return { data: {} } } } } },
  )
  await execute(sha)
  await assert.rejects(execute('b'.repeat(40)), /does not identify approved source/)
})
