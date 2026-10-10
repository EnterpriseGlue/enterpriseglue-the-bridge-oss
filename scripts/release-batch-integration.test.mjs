import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main as releaseNotes } from './release-notes.mjs'
import { verifyPublication } from './release-publication-approval.mjs'
import { detailedNotesMarker } from './lib/release-publication-policy.mjs'

const repository = 'EnterpriseGlue/enterpriseglue-the-bridge-oss'
const template = JSON.parse(readFileSync(new URL('../.release-notes/operator-controlled-release-batches.json', import.meta.url), 'utf8'))

function fixture(t, { wrongDocument = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eg-release-batch-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (file, data) => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), data) }
  git(['init', '--initial-branch=main'])
  git(['config', 'user.name', 'Local release regression'])
  git(['config', 'user.email', 'regression@example.test'])
  write('.gitignore', '.artifacts/\n')
  write('.github/.release-please-manifest.json', '{".":"0.29.3"}\n')
  write('.github/release-please-config.json', '{"bump-minor-pre-major":true}\n')
  write('CHANGELOG.md', '# Changelog\n\n## [0.29.3]\n')
  git(['add', '.']); git(['commit', '-m', 'chore: previous release']); git(['tag', 'v0.29.3'])
  const breaking = { ...structuredClone(template), id: 'breaking-one', type: 'breaking', breaking: true, summary: 'First PR changes a server installation contract.',
    api: { compatibility: 'breaking', changes: ['Supply server peers in direct consumers.'] }, packages: [] }
  write('.release-notes/breaking-one.json', JSON.stringify(breaking))
  write('scripts/first.mjs', 'export const first = true\n')
  git(['add', '.']); git(['commit', '-m', 'fix(deps)!: isolate server dependencies'])
  const first = git(['rev-parse', 'HEAD'])
  const fix = { ...structuredClone(template), id: 'fix-two', summary: 'Second PR fixes bounded browser evidence.', packages: [] }
  write('.release-notes/fix-two.json', JSON.stringify(fix))
  write('scripts/second.mjs', 'export const second = true\n')
  git(['add', '.']); git(['commit', '-m', 'fix(ci): bounded browser evidence'])
  const second = git(['rev-parse', 'HEAD'])
  return { root, git, write, first, second, wrongDocument }
}

function withPRMetadata(values, fn) {
  const keys = ['RELEASE_PR_TITLE', 'RELEASE_PR_LABELS', 'RELEASE_PR_CHANGED_FILES', 'RELEASE_NOTE_EXEMPT', 'RELEASE_PR_HEAD_REF']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key]
      else process.env[key] = values[key]
    }
    return fn()
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

test('a fix behind a breaking PR validates its own metadata while the release combines both', t => {
  const f = fixture(t)
  withPRMetadata({ RELEASE_PR_TITLE: 'fix(ci): bounded browser evidence', RELEASE_PR_LABELS: 'release:fix',
    RELEASE_PR_CHANGED_FILES: JSON.stringify(['scripts/second.mjs', '.release-notes/fix-two.json']) }, () => {
    assert.doesNotThrow(() => releaseNotes(['validate', '--base-ref', 'v0.29.3'], f.root))
    assert.doesNotThrow(() => releaseNotes(['assert-version', '--base-ref', 'v0.29.3', '--version', '0.30.0'], f.root))
  })
})

test('per-PR classification still rejects an incorrectly non-breaking title for its own breaking fragment', t => {
  const f = fixture(t)
  withPRMetadata({ RELEASE_PR_TITLE: 'fix: wrong classification', RELEASE_PR_LABELS: 'release:fix',
    RELEASE_PR_CHANGED_FILES: JSON.stringify(['scripts/first.mjs', '.release-notes/breaking-one.json']) }, () => {
    assert.throws(() => releaseNotes(['validate', '--base-ref', 'v0.29.3'], f.root), /require.*title with !/)
  })
})

function releaseFixture(t, options) {
  const f = fixture(t, options)
  releaseNotes(['render', '--base-ref', 'v0.29.3', '--version', '0.30.0', '--output', 'docs/releases/v0.30.0.md'], f.root)
  if (f.wrongDocument) f.write('docs/releases/v0.30.0.md', `${readFileSync(join(f.root, 'docs/releases/v0.30.0.md'), 'utf8')}Unverified extra claim.\n`)
  f.write('.github/.release-please-manifest.json', '{".":"0.30.0"}\n')
  f.write('CHANGELOG.md', '# Changelog\n\n## [0.30.0]\n\n## [0.29.3]\n')
  f.git(['add', '.']); f.git(['commit', '-m', 'chore(main)!: release 0.30.0'])
  const sha = f.git(['rev-parse', 'HEAD'])
  const document = readFileSync(join(f.root, 'docs/releases/v0.30.0.md'), 'utf8')
  const base = { ref: 'main', repo: { full_name: repository } }
  const releasePR = { number: 900, state: 'closed', merged: true, merged_at: '2026-10-09T00:00:00Z', merge_commit_sha: sha,
    title: 'chore(main): release 0.30.0', base, head: { ref: 'release-please--branches--main', repo: { full_name: repository } },
    labels: [{ name: 'autorelease: pending' }] }
  const codePRs = [f.first, f.second].map((commit, index) => ({ number: 551 + index, state: 'closed', merged: true,
    merged_at: '2026-10-09T00:00:00Z', merge_commit_sha: commit, base }))
  const runApi = endpoint => {
    if (endpoint.endsWith('/git/ref/heads/main')) return [{ object: { sha } }]
    for (const pr of codePRs) if (endpoint.endsWith(`/commits/${pr.merge_commit_sha}/pulls?per_page=100`)) return [[pr]]
    if (endpoint.endsWith('/pulls/900')) return [releasePR]
    if (endpoint.endsWith('/pulls/551')) return [codePRs[0]]
    if (endpoint.endsWith('/pulls/552')) return [codePRs[1]]
    if (endpoint.endsWith('/issues/900/comments')) return [[{ body: `${detailedNotesMarker}\n\n${document}` }]]
    if (endpoint.endsWith('/pulls?state=closed&per_page=100')) return [[releasePR]]
    throw new Error(`Unexpected API call ${endpoint}`)
  }
  const eventPath = join(f.root, '.artifacts/event.json')
  f.write('.artifacts/event.json', JSON.stringify({ inputs: { publish_release: true, source_ref: sha,
    release_tag: 'v0.30.0', release_pr: '900', required_prs: '[551,552]' } }))
  return { ...f, sha, runApi, env: { GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository, GITHUB_ACTOR: 'test-operator', GITHUB_RUN_ID: '1',
    GITHUB_OUTPUT: join(f.root, '.artifacts/output') } }
}

test('real Git ancestry and regenerated multi-PR documentation produce a non-publishing approval receipt', t => {
  const f = releaseFixture(t)
  const approval = verifyPublication({ root: f.root, env: f.env, runApi: f.runApi })
  assert.deepEqual(approval.requiredPRs, [551, 552])
  const record = JSON.parse(readFileSync(join(f.root, '.artifacts/release-publication/authorization.json'), 'utf8'))
  assert.equal(record.publicationPerformed, false)
  assert.equal(record.sourceRef, f.sha)
  assert.equal(f.git(['tag', '--list']), 'v0.29.3', 'The verifier must not create a release tag.')
})

test('matching PR comments cannot authorize a document that was not generated from the complete batch', t => {
  const f = releaseFixture(t, { wrongDocument: true })
  assert.throws(() => verifyPublication({ root: f.root, env: f.env, runApi: f.runApi }), /must be generated from every changed fragment/)
})

test('an automatic push on a prepared release merge never queries publication authority or creates a tag', t => {
  const f = releaseFixture(t)
  f.write('.artifacts/event.json', '{}')
  const result = verifyPublication({ root: f.root, env: { ...f.env, GITHUB_EVENT_NAME: 'push' },
    runApi: () => { throw new Error('Automatic preparation must not resolve publication authority') } })
  assert.equal(result.shouldPublish, false)
  assert.equal(result.shouldPrepare, false)
  assert.equal(f.git(['tag', '--list']), 'v0.29.3')
})

test('publication stops when live main moved after the dispatch snapshot', t => {
  const f = releaseFixture(t)
  assert.throws(() => verifyPublication({ root: f.root, env: f.env, runApi: endpoint => endpoint.endsWith('/git/ref/heads/main')
    ? [{ object: { sha: 'b'.repeat(40) } }] : f.runApi(endpoint) }), /Protected main moved/)
})

test('a valid source and document cannot publish an incompletely approved PR batch', t => {
  const f = releaseFixture(t)
  const event = JSON.parse(readFileSync(f.env.GITHUB_EVENT_PATH, 'utf8'))
  event.inputs.required_prs = '[551]'
  f.write('.artifacts/event.json', JSON.stringify(event))
  assert.throws(() => verifyPublication({ root: f.root, env: f.env, runApi: f.runApi }), /complete unreleased merged-PR batch/)
})

function repairFixture(t, path = 'scripts/release-publication-approval.mjs') {
  const f = releaseFixture(t)
  const releaseRoot = join(f.root, '.artifacts/frozen-source')
  execFileSync('git', ['clone', '--quiet', '--shared', f.root, releaseRoot])
  f.write(path, 'export const repaired = true\n')
  f.git(['add', path]); f.git(['commit', '-m', 'fix(release): repair publication tooling'])
  const controlRef = f.git(['rev-parse', 'HEAD'])
  const repair = {number:901,merged_at:'2026-10-10T00:00:00Z',merge_commit_sha:controlRef,
    base:{ref:'main',repo:{full_name:repository}},head:{ref:'fix/release-recovery',repo:{full_name:repository}}}
  const originalAPI = f.runApi
  f.runApi = endpoint => endpoint.endsWith('/git/ref/heads/main') ? [{object:{sha:controlRef}}]
    : endpoint.endsWith(`/commits/${controlRef}/pulls?per_page=100`) ? [[repair]] : originalAPI(endpoint)
  const event = JSON.parse(readFileSync(f.env.GITHUB_EVENT_PATH, 'utf8'))
  event.inputs.recovery_prs = '[901]'
  f.write('.artifacts/event.json', JSON.stringify(event))
  f.env = {...f.env,GITHUB_SHA:controlRef,RELEASE_SOURCE_ROOT:releaseRoot}
  return {...f,controlRef,releaseRoot,event}
}

test('a reviewed publication-only repair can use the frozen source and documentation without retagging', t => {
  const f = repairFixture(t)
  const approved = verifyPublication({root:f.root,env:f.env,runApi:f.runApi})
  assert.equal(approved.sourceRef,f.sha)
  assert.equal(approved.controlRef,f.controlRef)
  assert.deepEqual(approved.recoveryPRs,[901])
  assert.equal(f.git(['tag','--list']),'v0.29.3')
})

for (const path of ['packages/shared/package.json','pnpm-lock.yaml','backend/Dockerfile.prod','infra/kubernetes/helm/enterpriseglue-host/Chart.yaml',
  '.trivyignore','packages/shared/src/migrations/1700000000999.ts','unknown/recovery-helper.mjs']) {
  test(`recovery rejects intervening content changes to ${path}`, t => {
    const f=repairFixture(t,path)
    assert.throws(()=>verifyPublication({root:f.root,env:f.env,runApi:f.runApi}),/changes release content or an unallowlisted path/)
  })
}

test('recovery cannot omit the reviewed repair PR or invent additional repairs', t => {
  const f = repairFixture(t)
  for (const repairs of ['[]','[902]','[901,902]']) {
    f.event.inputs.recovery_prs=repairs
    f.write('.artifacts/event.json',JSON.stringify(f.event))
    assert.throws(()=>verifyPublication({root:f.root,env:f.env,runApi:f.runApi}),/requires an explicit|Unapproved intervening|exactly cover/)
  }
})

test('old pending labels within the previous published baseline are not active-release authority', t => {
  const f=releaseFixture(t)
  const old={number:1,merged_at:'2026-01-01',merge_commit_sha:f.git(['rev-parse','v0.29.3']),head:{ref:'release-please--branches--main'},labels:[{name:'autorelease: pending'}]}
  const api=f.runApi
  assert.doesNotThrow(()=>verifyPublication({root:f.root,env:f.env,runApi:endpoint=>endpoint.endsWith('/pulls?state=closed&per_page=100') ? [[old]] : api(endpoint)}))
})

test('replacement preparation accepts a reserved unpublished release but never a tag or GitHub release', t => {
  const f=releaseFixture(t)
  const event={inputs:{publish_release:false,prepare_replacement:true,source_ref:f.sha,release_tag:'v0.30.0',release_pr:'900'}}
  f.write('.artifacts/event.json',JSON.stringify(event))
  const original=f.runApi
  const missing=endpoint=>{
    if (endpoint.endsWith('/git/ref/tags/v0.30.0') || endpoint.endsWith('/releases/tags/v0.30.0')) throw Object.assign(new Error('Fixture missing tag/release'),{status:404})
    return original(endpoint)
  }
  const result=verifyPublication({root:f.root,env:f.env,runApi:missing})
  assert.equal(result.mode,'prepare-replacement')
  assert.equal(result.shouldPublish,false)
  assert.equal(JSON.parse(readFileSync(join(f.root,'.artifacts/release-publication/replacement.json'),'utf8')).publicationPerformed,false)
  for (const endpointSuffix of ['/git/ref/tags/v0.30.0','/releases/tags/v0.30.0']) {
    assert.throws(()=>verifyPublication({root:f.root,env:f.env,runApi:endpoint=>endpoint.endsWith(endpointSuffix) ? [{}] : missing(endpoint)}),/cannot be replaced/)
  }
})
