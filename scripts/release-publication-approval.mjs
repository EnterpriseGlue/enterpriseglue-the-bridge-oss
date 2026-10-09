#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { latestStableTag, main as releaseNotes } from './release-notes.mjs'
import { isPublicationRepairPath, resolveReleasePublication, validateReleasePublicationApproval } from './lib/release-publication-policy.mjs'
import { evaluateRepositoryLifecycle, loadRepositoryLifecycle } from '../plugins/enterpriseglue-dev-workflows/scripts/check-repository-lifecycle.mjs'

export function readPublicationApi(endpoint, { root = process.cwd(), execute = execFileSync, maxHistoryPages = 1000, paginate = true } = {}) {
  const history = /\/pulls\?state=closed&per_page=100$/.test(endpoint)
  const projection = 'map({number, merged_at, merge_commit_sha, head: {ref: .head.ref}, labels: [.labels[] | {name}]})'
  const read = (args, expectPage = false, single = false) => {
    const output = execute('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000 })
    assert.ok(output.trim(), 'The GitHub API returned no metadata.')
    const value = JSON.parse(output)
    if (single) return [value]
    assert.ok(Array.isArray(value), 'Expected a paginated API response.')
    if (expectPage) assert.ok(value.length <= 100, 'Closed-PR page exceeds its limit.')
    return value
  }
  try {
    if (!history) return paginate ? read(['api', '--paginate', '--slurp', endpoint]) : read(['api', endpoint], false, true)
    // Bound each response, omit historical bodies, and preserve every page.
    const pages = []
    for (let page = 1; page <= maxHistoryPages; page++) {
      const values = read(['api', '--jq', projection, `${endpoint}&page=${page}`], true)
      pages.push(values)
      if (values.length < 100) return pages
    }
    throw new Error('Closed-PR history exceeded the page bound.')
  } catch (error) {
    throw new Error(`Could not read publication metadata from ${endpoint} (${error.code || error.name}).`, { cause: error })
  }
}

export function verifyPublication({ root = process.cwd(), env = process.env, releaseRoot = env.RELEASE_SOURCE_ROOT || root,
  runGit = args => execFileSync('git', args, { cwd: releaseRoot, encoding: 'utf8' }).trim(),
  controlGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(),
  runApi = endpoint => readPublicationApi(endpoint, { root }) } = {}) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const manifestVersion = JSON.parse(readFileSync(join(releaseRoot, '.github/.release-please-manifest.json'), 'utf8'))['.']
  const baselineTag = latestStableTag(releaseRoot)
  const approval = resolveReleasePublication({ eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, sha: env.GITHUB_SHA,
    sourceSha: runGit(['rev-parse', 'HEAD']),
    commitMessage: runGit(['log', '-1', '--format=%B']), manifestVersion, latestTag: baselineTag, inputs: event.inputs })
  assert.equal(controlGit(['rev-parse', 'HEAD']), env.GITHUB_SHA, 'Protected checkout must match the workflow source.')
  if (approval.prepareReplacement) {
    assert.equal(controlGit(['status','--porcelain']), '', 'Replacement requires a clean protected checkout.')
    const repository=env.GITHUB_REPOSITORY
    assert.equal(evaluateRepositoryLifecycle(repository,{operation:'release',registry:loadRepositoryLifecycle()}).allowed,true)
    const api=endpoint=>runApi(`repos/${repository}/${endpoint}`)
    assert.equal(api('git/ref/heads/main')[0].object.sha,approval.sourceRef,'Protected source moved before replacement preparation.')
    const previous=api(`pulls/${approval.releasePR}`)[0]
    assert.ok(previous.merged && previous.state==='closed' && previous.base?.ref==='main' && previous.base?.repo?.full_name===repository &&
      previous.head?.repo?.full_name===repository && previous.head?.ref?.startsWith('release-please--branches--'), 'Replacement requires an owned merged release PR.')
    assert.equal(String(previous.title).match(/release (\d+\.\d+\.\d+)\b/i)?.[1],manifestVersion)
    assert.equal(spawnSync('git',['merge-base','--is-ancestor',previous.merge_commit_sha,approval.sourceRef],{cwd:root}).status,0)
    for (const endpoint of [`git/ref/tags/${approval.releaseTag}`,`releases/tags/${approval.releaseTag}`]) {
      let absent=false
      try {api(endpoint)} catch(error) {absent=error.status===404 || /HTTP 404|404 Not Found/.test(`${error.cause?.stderr || error.stderr || ''}`);if(!absent)throw error}
      assert.equal(absent,true,'A published or tagged version cannot be replaced; use a forward release.')
    }
    releaseNotes(['assert-version','--base-ref',baselineTag,'--version',manifestVersion],root)
    const directory=join(root,'.artifacts/release-publication')
    mkdirSync(directory,{recursive:true})
    writeFileSync(join(directory,'replacement.json'),JSON.stringify({sourceRef:approval.sourceRef,controlRef:approval.controlRef,
      releaseTag:approval.releaseTag,releasePR:approval.releasePR,previousTag:baselineTag,prepareReplacement:true,publicationPerformed:false},null,2)+'\n')
  }
  if (approval.shouldPublish) {
    assert.equal(runGit(['status', '--porcelain']), '', 'Publication requires a clean immutable source checkout.')
    const repository = env.GITHUB_REPOSITORY
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    const lifecycle = evaluateRepositoryLifecycle(repository, { operation: 'release', registry: loadRepositoryLifecycle() })
    assert.equal(lifecycle.allowed, true, lifecycle.reason)
    const api = endpoint => runApi(`repos/${repository}/${endpoint}`)
    assert.equal(api('git/ref/heads/main')[0].object.sha, approval.controlRef,
      'Protected main moved after approval; refresh the frozen batch before publication.')
    const repairs = new Set()
    if (approval.controlRef !== approval.sourceRef) {
      assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', approval.sourceRef, approval.controlRef], { cwd: root }).status, 0,
        'The frozen release must be an ancestor of the protected workflow revision.')
      for (const commit of controlGit(['rev-list', '--first-parent', `${approval.sourceRef}..${approval.controlRef}`]).split('\n').filter(Boolean)) {
        const pulls = api(`commits/${commit}/pulls?per_page=100`).flat().filter(pr => pr.merged_at &&
          pr.merge_commit_sha === commit && pr.base?.repo?.full_name === repository && pr.base?.ref === 'main' &&
          pr.head?.repo?.full_name === repository && !pr.head?.ref?.startsWith('release-please--branches--'))
        assert.equal(pulls.length, 1, `Workflow repair commit ${commit} must identify exactly one merged first-party code PR.`)
        assert.ok(approval.recoveryPRs.includes(pulls[0].number), `Unapproved intervening repair PR #${pulls[0].number}.`)
        const paths = controlGit(['diff', '--name-only', `${commit}^1`, commit]).split('\n').filter(Boolean)
        assert.ok(paths.length && paths.every(isPublicationRepairPath), `Repair PR #${pulls[0].number} changes release content or an unallowlisted path.`)
        repairs.add(pulls[0].number)
      }
    }
    assert.deepEqual([...repairs].sort((a, b) => a - b), [...approval.recoveryPRs].sort((a, b) => a - b),
      'recovery_prs must exactly cover the reviewed publication-only changes after the frozen candidate.')
    const releasePR = api(`pulls/${approval.releasePR}`)[0]
    const codePRs = approval.requiredPRs.map(number => api(`pulls/${number}`)[0])
    const includedPRs = new Set()
    for (const pr of codePRs) {
      assert.match(pr.merge_commit_sha ?? '', /^[0-9a-f]{40}$/, `PR #${pr.number} requires a merged commit identity.`)
      const result = spawnSync('git', ['merge-base', '--is-ancestor', pr.merge_commit_sha, approval.sourceRef], { cwd: releaseRoot })
      if (result.status === 0) includedPRs.add(pr.number)
      else assert.equal(result.status, 1, `Could not verify ancestry of PR #${pr.number}.`)
    }
    const document = readFileSync(join(releaseRoot, `docs/releases/${approval.releaseTag}.md`), 'utf8')
    const comments = api(`issues/${approval.releasePR}/comments`).flat().map(comment => comment.body)
    validateReleasePublicationApproval({ approval, repository, releasePR, codePRs, includedPRs,
      releaseDocument: document, managedComments: comments })
    const pendingReleases = api('pulls?state=closed&per_page=100').flat().filter(pr => pr.merged_at &&
      pr.head?.ref?.startsWith('release-please--branches--') && pr.labels?.some(label => ['autorelease: pending', 'autorelease: triggered'].includes(label.name)))
    const comparisonTag = baselineTag === approval.releaseTag
      ? runGit(['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').find(tag => /^v\d+\.\d+\.\d+$/.test(tag) && tag !== approval.releaseTag)
      : baselineTag
    assert.ok(comparisonTag, 'An immutable previous release baseline is required.')
    for (const pr of pendingReleases) {
      if (pr.number === approval.releasePR) continue
      assert.match(pr.merge_commit_sha ?? '', /^[0-9a-f]{40}$/, 'A pending release requires a merge identity.')
      const historical = spawnSync('git', ['merge-base', '--is-ancestor', pr.merge_commit_sha, comparisonTag], { cwd: releaseRoot })
      assert.equal(historical.status, 0, 'Another merged release PR is awaiting publication; resolve that batch first.')
    }
    const mergedBatch = new Set()
    for (const commit of runGit(['rev-list', '--first-parent', `${comparisonTag}..${approval.sourceRef}`]).split('\n').filter(Boolean)) {
      if (commit === approval.sourceRef) continue
      assert.match(commit, /^[0-9a-f]{40}$/)
      const associated = api(`commits/${commit}/pulls?per_page=100`).flat()
        .filter(pr => pr.merged_at && pr.merge_commit_sha === commit && pr.base?.repo?.full_name === repository && pr.base?.ref === 'main')
      assert.equal(associated.length, 1, `Unreleased main commit ${commit} must identify exactly one merged code PR.`)
      const pull=associated[0]
      if (pull.head?.ref?.startsWith('release-please--branches--')) {
        assert.equal(pull.head?.repo?.full_name,repository,'A superseded release PR must be repository-owned.')
        assert.ok(pull.labels?.some(label=>label.name==='autorelease: superseded'),'An unpublished release merge must be explicitly superseded before selecting another candidate.')
        assert.equal(String(pull.title).match(/release (\d+\.\d+\.\d+)\b/i)?.[1],manifestVersion,'A superseded reservation must match the selected version.')
        const paths=runGit(['diff','--name-only',`${commit}^1`,commit]).split('\n').filter(Boolean)
        const allowed=['.github/.release-please-manifest.json','CHANGELOG.md',`docs/releases/${approval.releaseTag}.md`,'infra/kubernetes/helm/enterpriseglue-host/Chart.yaml']
        assert.ok(paths.length && paths.every(path=>allowed.includes(path)), 'A superseded release merge cannot contain code changes.')
        continue
      }
      mergedBatch.add(associated[0].number)
    }
    assert.deepEqual([...mergedBatch].sort((a, b) => a - b), [...approval.requiredPRs].sort((a, b) => a - b),
      'Approved required_prs must cover the complete unreleased merged-PR batch, including additional changes.')
    const generated = '.artifacts/release-publication/generated-release-notes.md'
    releaseNotes(['assert-version', '--base-ref', comparisonTag, '--version', manifestVersion], releaseRoot)
    releaseNotes(['render', '--base-ref', comparisonTag, '--version', manifestVersion, '--output', generated], releaseRoot)
    assert.equal(readFileSync(join(releaseRoot, generated), 'utf8'), document, 'Release document must be generated from every changed fragment in the complete batch.')
    const record = { schemaVersion: 1, sourceRef: approval.sourceRef, releaseTag: approval.releaseTag,
      releasePR: approval.releasePR, requiredPRs: approval.requiredPRs, previousTag: comparisonTag,
      controlRef: approval.controlRef, recoveryPRs: approval.recoveryPRs,
      documentation: { path: `docs/releases/${approval.releaseTag}.md`, sha256: createHash('sha256').update(document).digest('hex'),
        changelogSha256: createHash('sha256').update(readFileSync(join(releaseRoot, 'CHANGELOG.md'))).digest('hex') },
      requestedBy: env.GITHUB_ACTOR, workflowRun: env.GITHUB_RUN_ID, publicationPerformed: false }
    const directory = join(root, '.artifacts/release-publication')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'authorization.json'), `${JSON.stringify(record, null, 2)}\n`)
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `is_release=${approval.shouldPublish}\nshould_prepare=${approval.shouldPrepare}\nrelease_tag=${approval.releaseTag}\nsource_ref=${approval.sourceRef ?? ''}\nmode=${approval.mode}\nreplacement_version=${approval.prepareReplacement ? approval.releaseTag.slice(1) : ''}\n`)
  console.log(`[release-publication] mode=${approval.mode}; automatic events never publish.`)
  return approval
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try { verifyPublication() } catch (error) {
    console.error(`[release-publication] ${error.message}`)
    process.exitCode = 1
  }
}
