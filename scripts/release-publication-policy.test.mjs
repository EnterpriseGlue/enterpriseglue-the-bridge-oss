import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { readPublicationApi } from './release-publication-approval.mjs'
import './release-publication-record.test.mjs'
import { detailedNotesMarker, resolveReleasePublication, validateReleasePublicationApproval } from './lib/release-publication-policy.mjs'

const sha = 'a'.repeat(40)
const repository = 'EnterpriseGlue/enterpriseglue-the-bridge-oss'
const approvedInputs = { publish_release: true, source_ref: sha, release_tag: 'v0.30.0', release_pr: '900', required_prs: '[551,554]' }
const publicationContext = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha,
  commitMessage: 'chore(main)!: release 0.30.0', manifestVersion: '0.30.0', latestTag: 'v0.29.3', inputs: approvedInputs }

test('closed-PR history retains every page and pending-release field without retrieving PR bodies', () => {
  const pending = { number: 900, merged_at: '2026-10-09', merge_commit_sha: sha, head: { ref: 'release-please--branches--main' },
    labels: [{ name: 'autorelease: pending' }] }
  const pages = [Array.from({length: 100}, (_, number) => ({number, merged_at: null, head: {}, labels: []})), [pending]]
  let requests = 0
  const result = readPublicationApi(`repos/${repository}/pulls?state=closed&per_page=100`, { execute(command, args) {
    assert.equal(command, 'gh')
    assert.ok(!args.includes('--paginate') && !args.includes('--slurp'), 'Each projected response is bounded independently.')
    assert.equal(args[args.indexOf('--jq') + 1],
      'map({number, merged_at, merge_commit_sha, head: {ref: .head.ref}, labels: [.labels[] | {name}]})')
    assert.ok(args.at(-1).endsWith(`&page=${requests + 1}`))
    return JSON.stringify(pages[requests++])
  } })
  assert.deepEqual(result, pages)
  assert.equal(requests, 2)
})

test('publication metadata larger than the default subprocess buffer is read completely', () => {
  const body = 'x'.repeat(2 * 1024 * 1024)
  const pages = readPublicationApi(`repos/${repository}/issues/900/comments`, { execute(command, args, options) {
    assert.equal(command, 'gh')
    assert.ok(args.includes('--slurp'))
    return execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify([[{body:"x".repeat(2*1024*1024)}]]))'], options)
  } })
  assert.equal(pages[0][0].body, body)
})

test('publisher observation reads a bounded recent-run page without downloading complete workflow history', () => {
  const page={workflow_runs:[{id:1,status:'completed'}]}
  const result=readPublicationApi(`repos/${repository}/actions/workflows/docker-images.yml/runs?per_page=100`,{
    paginate:false,execute(command,args){assert.equal(command,'gh');assert.ok(!args.includes('--paginate'));return JSON.stringify(page)},
  })
  assert.deepEqual(result,[page])
})

test('failed or malformed publication API responses fail closed with endpoint diagnostics', () => {
  const endpoint = `repos/${repository}/pulls/900`
  for (const execute of [() => 'truncated JSON', () => { throw Object.assign(new Error('private response'), { code: 'ENOBUFS' }) }]) {
    assert.throws(() => readPublicationApi(endpoint, { execute }), error => {
      assert.ok(error.message.includes(endpoint))
      assert.ok(!error.message.includes('private response'))
      return true
    })
  }
})

test('missing or malformed closed-PR pages cannot silently become an empty history', () => {
  const endpoint = `repos/${repository}/pulls?state=closed&per_page=100`
  for (const response of ['', '\n', '{}\n', 'null\n']) {
    assert.throws(() => readPublicationApi(endpoint, { execute: () => response }), /Could not read publication metadata/)
  }
  assert.deepEqual(readPublicationApi(endpoint, { execute: () => '[]\n' }), [[]])
})

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

test('an unpublished reserved version can prepare a replacement only through an explicit protected dispatch', () => {
  const inputs={publish_release:false,prepare_replacement:true,source_ref:sha,release_tag:'v0.30.0',release_pr:'900'}
  const result=resolveReleasePublication({...publicationContext,commitMessage:'fix: patch candidate content',inputs})
  assert.equal(result.shouldPublish,false)
  assert.equal(result.shouldPrepare,true)
  assert.equal(result.mode,'prepare-replacement')
  assert.equal(result.releaseTag,'v0.30.0')
  assert.throws(()=>resolveReleasePublication({...publicationContext,eventName:'push',inputs}),/Only an explicit dispatch/)
  assert.throws(()=>resolveReleasePublication({...publicationContext,latestTag:'v0.30.0',inputs}),/has not been published/)
  assert.throws(()=>resolveReleasePublication({...publicationContext,inputs:{...inputs,publish_release:true}}),/separate operations/)
  assert.throws(()=>resolveReleasePublication({...publicationContext,inputs:{...inputs,source_ref:'b'.repeat(40)}}),/current protected source/)
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
