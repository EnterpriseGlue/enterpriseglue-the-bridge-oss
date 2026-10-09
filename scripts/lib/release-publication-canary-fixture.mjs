import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as releaseNotes } from '../release-notes.mjs'
import { detailedNotesMarker } from './release-publication-policy.mjs'

// Disposable release history and read-only GitHub responses. Nothing here is
// production authority. The canary runs the unmodified production CLI against it.
export function createCanaryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'eg-publication-canary-'))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (file, value) => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), value) }
  const repository = 'EnterpriseGlue/enterpriseglue-the-bridge-oss'
  git(['init', '--initial-branch=main'])
  git(['config', 'user.name', 'Release authorization canary'])
  git(['config', 'user.email', 'canary@example.invalid'])
  write('.gitignore', '.artifacts/\n')
  write('.github/.release-please-manifest.json', '{".":"0.29.3"}\n')
  write('.github/release-please-config.json', '{"bump-minor-pre-major":true}\n')
  write('CHANGELOG.md', '# Changelog\n\n## [0.29.3]\n')
  git(['add', '.']); git(['commit', '-m', 'chore: fixture baseline']); git(['tag', 'v0.29.3'])
  const template = JSON.parse(readFileSync(new URL('../../.release-notes/operator-controlled-release-batches.json', import.meta.url), 'utf8'))
  const base = { ref: 'main', repo: { full_name: repository } }
  const codePRs = [551, 552].map(number => {
    const fragment = { ...template, id: `canary-${number}`, summary: `Canary fixture change ${number}.` }
    write(`.release-notes/canary-${number}.json`, JSON.stringify(fragment))
    write(`scripts/canary-${number}.mjs`, `export const fixture = ${number}\n`)
    git(['add', '.']); git(['commit', '-m', `fix: canary fixture ${number}`])
    return { number, state: 'closed', merged: true, merged_at: '2026-10-09T00:00:00Z', merge_commit_sha: git(['rev-parse', 'HEAD']), base }
  })
  releaseNotes(['render', '--base-ref', 'v0.29.3', '--version', '0.29.4', '--output', 'docs/releases/v0.29.4.md'], root)
  const document = readFileSync(join(root, 'docs/releases/v0.29.4.md'), 'utf8')
  write('.github/.release-please-manifest.json', '{".":"0.29.4"}\n')
  write('CHANGELOG.md', '# Changelog\n\n## [0.29.4]\n\n## [0.29.3]\n')
  git(['add', '.']); git(['commit', '-m', 'chore(main): release 0.29.4'])
  const sha = git(['rev-parse', 'HEAD'])
  const releasePR = { number: 900, state: 'closed', merged: true, merged_at: '2026-10-09T00:00:00Z', merge_commit_sha: sha,
    title: 'chore(main): release 0.29.4', base, head: { ref: 'release-please--branches--main', repo: { full_name: repository } },
    labels: [{ name: 'autorelease: pending' }] }
  const prefix = `repos/${repository}/`
  const api = {
    [`${prefix}git/ref/heads/main`]: [{ object: { sha } }],
    [`${prefix}pulls/900`]: [releasePR],
    [`${prefix}issues/900/comments`]: [[{ body: `${detailedNotesMarker}\n\n${document}` }]],
    [`${prefix}pulls?state=closed&per_page=100`]: [[{ ...releasePR, body: 'x'.repeat(2 * 1024 * 1024) }, ...Array.from({length: 99}, (_, index) => ({number: 1000 + index, merged_at: null, labels: []}))], codePRs],
  }
  for (const pr of codePRs) {
    api[`${prefix}pulls/${pr.number}`] = [pr]
    api[`${prefix}commits/${pr.merge_commit_sha}/pulls?per_page=100`] = [[pr]]
  }
  write('.artifacts/api.json', JSON.stringify(api))
  write('.artifacts/bin/gh', `#!${process.execPath}
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'HOME']) assert.equal(process.env[key], undefined);
const args = process.argv.slice(2);
assert.equal(args[0], 'api');
const history = args[1] === '--jq';
if (history) {
  assert.equal(args.length, 4);
  assert.equal(args[2], 'map({number, merged_at, merge_commit_sha, head: {ref: .head.ref}, labels: [.labels[] | {name}]})');
} else {
  assert.deepEqual(args.slice(0, 3), ['api', '--paginate', '--slurp']);
  assert.equal(args.length, 4);
}
const endpoint = args.at(-1).replace(/&page=\\d+$/, '');
const pageIndex = Number(args.at(-1).match(/&page=(\\d+)$/)?.[1] || '1') - 1;
const api = JSON.parse(readFileSync(process.env.CANARY_API_FILE, 'utf8'));
assert.ok(Object.hasOwn(api, endpoint), 'Unallowlisted fixture API request');
assert.equal(history, endpoint.endsWith('/pulls?state=closed&per_page=100'));
appendFileSync(process.env.CANARY_API_TRACE, endpoint + '\\n');
if (history) {
  const page = api[endpoint][pageIndex] || [];
  console.log(JSON.stringify(page.map(pr => ({number: pr.number, merged_at: pr.merged_at, merge_commit_sha: pr.merge_commit_sha,
    head: {ref: pr.head?.ref}, labels: (pr.labels || []).map(({name}) => ({name}))}))));
} else console.log(JSON.stringify(api[endpoint]));
`)
  const inputs = { publish_release: true, source_ref: sha, release_tag: 'v0.29.4', release_pr: '900', required_prs: '[551,552]' }
  return { root, git, write, sha, repository, api, inputs, prefix }
}
