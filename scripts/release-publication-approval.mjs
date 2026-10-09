#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { latestStableTag, main as releaseNotes } from './release-notes.mjs'
import { resolveReleasePublication, validateReleasePublicationApproval } from './lib/release-publication-policy.mjs'
import { evaluateRepositoryLifecycle, loadRepositoryLifecycle } from '../plugins/enterpriseglue-dev-workflows/scripts/check-repository-lifecycle.mjs'

export function verifyPublication({ root = process.cwd(), env = process.env, runGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(),
  runApi = endpoint => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { cwd: root, encoding: 'utf8' })) } = {}) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const manifestVersion = JSON.parse(readFileSync(join(root, '.github/.release-please-manifest.json'), 'utf8'))['.']
  const baselineTag = latestStableTag(root)
  const approval = resolveReleasePublication({ eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, sha: env.GITHUB_SHA,
    commitMessage: runGit(['log', '-1', '--format=%B']), manifestVersion, latestTag: baselineTag, inputs: event.inputs })
  assert.equal(runGit(['rev-parse', 'HEAD']), env.GITHUB_SHA, 'Protected checkout must match the workflow source.')
  if (approval.shouldPublish) {
    assert.equal(runGit(['status', '--porcelain']), '', 'Publication requires a clean immutable source checkout.')
    const repository = env.GITHUB_REPOSITORY
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    const lifecycle = evaluateRepositoryLifecycle(repository, { operation: 'release', registry: loadRepositoryLifecycle() })
    assert.equal(lifecycle.allowed, true, lifecycle.reason)
    const api = endpoint => runApi(`repos/${repository}/${endpoint}`)
    assert.equal(api('git/ref/heads/main')[0].object.sha, approval.sourceRef,
      'Protected main moved after approval; refresh the frozen batch before publication.')
    const releasePR = api(`pulls/${approval.releasePR}`)[0]
    const codePRs = approval.requiredPRs.map(number => api(`pulls/${number}`)[0])
    const includedPRs = new Set()
    for (const pr of codePRs) {
      assert.match(pr.merge_commit_sha ?? '', /^[0-9a-f]{40}$/, `PR #${pr.number} requires a merged commit identity.`)
      const result = spawnSync('git', ['merge-base', '--is-ancestor', pr.merge_commit_sha, approval.sourceRef], { cwd: root })
      if (result.status === 0) includedPRs.add(pr.number)
      else assert.equal(result.status, 1, `Could not verify ancestry of PR #${pr.number}.`)
    }
    const document = readFileSync(join(root, `docs/releases/${approval.releaseTag}.md`), 'utf8')
    const comments = api(`issues/${approval.releasePR}/comments`).flat().map(comment => comment.body)
    validateReleasePublicationApproval({ approval, repository, releasePR, codePRs, includedPRs,
      releaseDocument: document, managedComments: comments })
    const pendingReleases = api('pulls?state=closed&per_page=100').flat().filter(pr => pr.merged_at &&
      pr.head?.ref?.startsWith('release-please--branches--') && pr.labels?.some(label => ['autorelease: pending', 'autorelease: triggered'].includes(label.name)))
    assert.ok(pendingReleases.every(pr => pr.number === approval.releasePR), 'Another merged release PR is awaiting publication; resolve that batch first.')
    const comparisonTag = baselineTag === approval.releaseTag
      ? runGit(['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').find(tag => /^v\d+\.\d+\.\d+$/.test(tag) && tag !== approval.releaseTag)
      : baselineTag
    assert.ok(comparisonTag, 'An immutable previous release baseline is required.')
    const mergedBatch = new Set()
    for (const commit of runGit(['rev-list', '--first-parent', `${comparisonTag}..${approval.sourceRef}`]).split('\n').filter(Boolean)) {
      if (commit === approval.sourceRef) continue
      assert.match(commit, /^[0-9a-f]{40}$/)
      const associated = api(`commits/${commit}/pulls?per_page=100`).flat()
        .filter(pr => pr.merged_at && pr.merge_commit_sha === commit && pr.base?.repo?.full_name === repository && pr.base?.ref === 'main')
      assert.equal(associated.length, 1, `Unreleased main commit ${commit} must identify exactly one merged code PR.`)
      mergedBatch.add(associated[0].number)
    }
    assert.deepEqual([...mergedBatch].sort((a, b) => a - b), [...approval.requiredPRs].sort((a, b) => a - b),
      'Approved required_prs must cover the complete unreleased merged-PR batch, including additional changes.')
    const generated = '.artifacts/release-publication/generated-release-notes.md'
    releaseNotes(['assert-version', '--base-ref', comparisonTag, '--version', manifestVersion], root)
    releaseNotes(['render', '--base-ref', comparisonTag, '--version', manifestVersion, '--output', generated], root)
    assert.equal(readFileSync(join(root, generated), 'utf8'), document, 'Release document must be generated from every changed fragment in the complete batch.')
    const record = { schemaVersion: 1, sourceRef: approval.sourceRef, releaseTag: approval.releaseTag,
      releasePR: approval.releasePR, requiredPRs: approval.requiredPRs, previousTag: comparisonTag,
      requestedBy: env.GITHUB_ACTOR, workflowRun: env.GITHUB_RUN_ID, publicationPerformed: false }
    const directory = join(root, '.artifacts/release-publication')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'authorization.json'), `${JSON.stringify(record, null, 2)}\n`)
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `is_release=${approval.shouldPublish}\nshould_prepare=${approval.shouldPrepare}\nrelease_tag=${approval.releaseTag}\nsource_ref=${approval.sourceRef ?? ''}\nmode=${approval.mode}\n`)
  console.log(`[release-publication] mode=${approval.mode}; automatic events never publish.`)
  return approval
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try { verifyPublication() } catch (error) {
    console.error(`[release-publication] ${error.message}`)
    process.exitCode = 1
  }
}
