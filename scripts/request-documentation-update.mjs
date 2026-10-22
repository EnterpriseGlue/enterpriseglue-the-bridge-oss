import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const repository = 'EnterpriseGlue/enterpriseglue-the-bridge-oss'
export async function requestDocumentationUpdate({ tag, env = process.env, execute = execFileSync,
  wait = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const read = path => JSON.parse(execute('gh', ['api', `repos/${repository}/${path}`], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, env: { ...env, GH_TOKEN: env.GH_TOKEN } }))
  if (tag) assert.match(tag, /^v\d+\.\d+\.\d+$/)
  const release = read(tag ? `releases/tags/${tag}` : 'releases/latest')
  assert.equal(release.draft, false); assert.equal(release.prerelease, false); assert.ok(release.published_at)
  tag = release.tag_name; assert.match(tag, /^v\d+\.\d+\.\d+$/)
  const source = read(`commits/${tag}`).sha; assert.match(source, /^[0-9a-f]{40}$/)
  const file = read(`contents/docs/releases/${tag}.md?ref=${source}`)
  assert.equal(file.encoding, 'base64')
  const notes = Buffer.from(file.content, 'base64').toString('utf8')
  assert.equal(release.body.trim(), notes.trim(), 'GitHub release notes must match the existing canonical Markdown before documentation intake.')
  assert.ok(env.DOCUMENTATION_UPDATE_TOKEN, 'Documentation is pending: configure the separate private-workflow handoff token.')
  const body = { ref: 'main', inputs: { release_tag: tag, source_commit: source,
    notes_sha256: createHash('sha256').update(notes).digest('hex') } }
  let error
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      execute('gh', ['api', '--method', 'POST', 'repos/EnterpriseGlue/enterpriseglue-homepage/actions/workflows/documentation-update.yml/dispatches', '--input', '-'], {
        input: JSON.stringify(body), encoding: 'utf8', timeout: 30000, env: { ...env, GH_TOKEN: env.DOCUMENTATION_UPDATE_TOKEN } })
      return { status: 'handoff-accepted', releaseTag: tag, sourceCommit: source, documentationPublished: false }
    } catch (failure) { error = failure; if (attempt < 2) await wait(2000 * (attempt + 1)) }
  }
  throw new Error('Documentation handoff is pending after three delivery attempts; retry this independent workflow.', { cause: error })
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  try {
    const result = await requestDocumentationUpdate({tag: process.env.DOCUMENTATION_RELEASE_TAG || undefined})
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Documentation: ${result.status} for ${result.releaseTag}. Content review and publishing are independent.\n`)
    console.log(JSON.stringify(result))
  } catch (error) {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'Documentation: pending. Retry this workflow after resolving its configuration or transport error. OSS publication is independent.\n')
    console.error(error.message); process.exitCode = 1
  }
}
