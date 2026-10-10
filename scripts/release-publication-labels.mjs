#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readPublicationApi } from './release-publication-approval.mjs'

const OVERRIDE_START = '<!-- enterpriseglue-reserved-release-version -->'
const OVERRIDE_END = '<!-- /enterpriseglue-reserved-release-version -->'

export function reservedVersionCommitOverride(pull, releaseTag) {
  assert.match(releaseTag, /^v\d+\.\d+\.\d+$/)
  assert.match(pull.title, /^[a-z]+(?:\([^\r\n)]+\))?!?: [^\r\n]+$/)
  assert.ok(!pull.head.ref.startsWith('release-please--branches--'), 'Generated release PR bodies must not be overridden.')
  const body = pull.body || ''
  const start = body.indexOf(OVERRIDE_START)
  let preserved = body
  if (start !== -1) {
    const end = body.indexOf(OVERRIDE_END, start)
    assert.ok(end !== -1 && body.indexOf(OVERRIDE_START, start + 1) === -1, 'Malformed managed version override.')
    preserved = body.slice(0, start) + body.slice(end + OVERRIDE_END.length)
  }
  assert.ok(!preserved.includes('BEGIN_COMMIT_OVERRIDE') && !preserved.includes('END_COMMIT_OVERRIDE'),
    'An existing human commit override needs an explicit review instead of replacement.')
  const next = `${preserved.trimEnd()}\n\n${OVERRIDE_START}\nBEGIN_COMMIT_OVERRIDE\n${pull.title}\n\nRelease-As: ${releaseTag.slice(1)}\nEND_COMMIT_OVERRIDE\n${OVERRIDE_END}\n`
  assert.ok(Buffer.byteLength(next) <= 65536, 'The version override exceeds GitHub PR body limits.')
  return next
}

export function prepareReplacementMetadata({ authorization, repository = process.env.GITHUB_REPOSITORY,
  pages = readPublicationApi(`repos/${repository}/pulls?state=closed&per_page=100`),
  isAncestor = sha => spawnSync('git', ['merge-base', '--is-ancestor', sha, authorization.sourceRef]).status,
  readPull = number => readPublicationApi(`repos/${repository}/pulls/${number}`)[0],
  writeBody = (number, body) => execFileSync('gh', ['api', '--method', 'PATCH', `repos/${repository}/pulls/${number}`, '--input', '-'],
    {input: JSON.stringify({body}), stdio: ['pipe', 'pipe', 'pipe']}),
  addLabel = (number, name) => execFileSync('gh', ['api', '--method', 'POST', `repos/${repository}/issues/${number}/labels`, '--input', '-'],
    {input: JSON.stringify({labels: [name]}), stdio: ['pipe', 'pipe', 'pipe']}),
  removeLabel = (number, name) => execFileSync('gh', ['api', '--method', 'DELETE', `repos/${repository}/issues/${number}/labels/${encodeURIComponent(name)}`],
    {stdio: ['ignore', 'pipe', 'pipe']}) }) {
  assert.equal(repository, 'EnterpriseGlue/enterpriseglue-the-bridge-oss')
  assert.equal(authorization.prepareReplacement, true)
  const code = pages.flat().filter(pull => pull.merged_at && !pull.head.ref.startsWith('release-please--branches--') &&
    /^[a-f0-9]{40}$/.test(pull.merge_commit_sha) && isAncestor(pull.merge_commit_sha) === 0)
    .sort((a, b) => b.merged_at.localeCompare(a.merged_at))[0]
  assert.ok(code, 'No reviewed code PR in the replacement source can carry the reserved version.')
  const pull = readPull(code.number)
  assert.equal(pull.head.repo.full_name, repository, 'Version overrides require a first-party code PR.')
  const body = reservedVersionCommitOverride(pull, authorization.releaseTag)
  if (body !== pull.body) writeBody(code.number, body)
  const reservation = readPull(authorization.releasePR)
  addLabel(authorization.releasePR, 'autorelease: superseded')
  // Legacy label definitions may be absent. Remove only states that actually
  // exist on the reservation, using REST rather than gh's label-name lookup.
  for (const {name} of reservation.labels.filter(label => ['autorelease: pending', 'autorelease: triggered'].includes(label.name))) {
    removeLabel(authorization.releasePR, name)
  }
  return {supersededReleasePR: authorization.releasePR, versionOverridePR: code.number, publicationPerformed: false}
}

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
    console.log(JSON.stringify(prepareReplacementMetadata({authorization})))
    process.exit(0)
  }
  console.log(JSON.stringify({ removed: reconcileHistoricalReleaseLabels({ authorization }) }))
}
