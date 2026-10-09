#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readPublicationApi } from './release-publication-approval.mjs'

export function reconcileHistoricalReleaseLabels({ authorization, repository = process.env.GITHUB_REPOSITORY,
  pages = readPublicationApi(`repos/${repository}/pulls?state=closed&per_page=100`),
  isAncestor = sha => spawnSync('git', ['merge-base', '--is-ancestor', sha, authorization.previousTag]).status,
  remove = (number, label) => execFileSync('gh', ['api', '--method', 'DELETE',
    `repos/${repository}/issues/${number}/labels/${encodeURIComponent(label)}`], { stdio: ['ignore', 'pipe', 'pipe'] }) }) {
  assert.equal(repository, 'EnterpriseGlue/enterpriseglue-the-bridge-oss')
  const removed = []
  for (const pr of pages.flat()) {
    if (pr.number === authorization.releasePR || !pr.merged_at || !pr.head?.ref?.startsWith('release-please--branches--')) continue
    const labels = pr.labels.filter(({ name }) => ['autorelease: pending', 'autorelease: triggered'].includes(name))
    if (!labels.length) continue
    assert.match(pr.merge_commit_sha, /^[a-f0-9]{40}$/)
    assert.equal(isAncestor(pr.merge_commit_sha), 0, 'An active unpublished release must not be relabelled as historical.')
    for (const { name } of labels) { remove(pr.number, name); removed.push({ number: pr.number, label: name }) }
  }
  return removed
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  const authorization = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch')
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), authorization.controlRef)
  if (process.argv[3] === 'replace') {
    assert.equal(authorization.prepareReplacement,true)
    for (const endpoint of [`git/ref/tags/${authorization.releaseTag}`,`releases/tags/${authorization.releaseTag}`]) {
      let absent=false
      try {readPublicationApi(`repos/${process.env.GITHUB_REPOSITORY}/${endpoint}`)} catch(error) {
        absent=/HTTP 404|404 Not Found/.test(`${error.cause?.stderr || ''}`);if(!absent)throw error
      }
      assert.equal(absent,true,'A published or tagged release cannot be superseded.')
    }
    reconcileHistoricalReleaseLabels({authorization})
    execFileSync('gh',['label','create','autorelease: superseded','--repo',process.env.GITHUB_REPOSITORY,
      '--description','Unpublished candidate reservation replaced by a newly qualified candidate','--color','6B7280','--force'],{stdio:['ignore','pipe','pipe']})
    execFileSync('gh',['pr','edit',String(authorization.releasePR),'--repo',process.env.GITHUB_REPOSITORY,
      '--add-label','autorelease: superseded','--remove-label','autorelease: pending,autorelease: triggered'],{stdio:['ignore','pipe','pipe']})
    console.log(JSON.stringify({supersededReleasePR:authorization.releasePR,publicationPerformed:false}))
    process.exit(0)
  }
  console.log(JSON.stringify({ removed: reconcileHistoricalReleaseLabels({ authorization }) }))
}
