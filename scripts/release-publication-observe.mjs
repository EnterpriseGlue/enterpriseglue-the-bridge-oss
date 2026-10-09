#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalPackageDigest, createNpmRegistryClient } from './publish-plugin-package-set.mjs'
import { readPublicationApi } from './release-publication-approval.mjs'
import { hashBytes } from './lib/release-publication-record.mjs'
import { observePublication, resumePublication } from './lib/release-publication-observation.mjs'

export function productionObservers({ record, artifacts, evidence, repository = process.env.GITHUB_REPOSITORY }) {
  assert.equal(repository, 'EnterpriseGlue/enterpriseglue-the-bridge-oss')
  const command = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 }).trim()
  const api = endpoint => readPublicationApi(`repos/${repository}/${endpoint}`, {paginate:!endpoint.startsWith('actions/workflows/')})[0]
  const missing = error => /MANIFEST_UNKNOWN|manifest unknown|NAME_UNKNOWN|HTTP 404|404 Not Found/.test(`${error.cause?.stderr || error.stderr || ''}`)
  const registry = createNpmRegistryClient()
  const context = `https://github.com/${repository}`.replaceAll('.', '\\.')
  const signature = subject => command('cosign', ['verify', '--certificate-identity-regexp',
    `^${context}/\\.github/workflows/(docker-images-reusable|release-candidate-stage|host-chart-release|plugin-toolchain-release)\\.yml@(refs/heads/main|refs/tags/${record.identity.releaseTag})$`,
    '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', subject])
  const signatures = new Set()
  const source = record.identity.sourceRef
  const tag = record.identity.releaseTag
  const workflow = async (publisher, current) => {
    const runs = [...api(`actions/workflows/${publisher}/runs?per_page=100`).workflow_runs]
    for (const sha of new Set([source, current.authorization.controlRef])) {
      runs.push(...api(`actions/workflows/${publisher}/runs?per_page=30&head_sha=${sha}`).workflow_runs)
    }
    const matching = runs.filter(run => (run.event === 'release' && run.head_sha === source) ||
      (['workflow_dispatch', 'workflow_run'].includes(run.event) && run.display_title?.endsWith(` / ${source}`)))
      .sort((a, b) => b.id - a.id)
    const run = matching[0]
    if (!run) return { status: 'missing' }
    if (run.status !== 'completed') return { status: 'pending', runId: run.id, url: run.html_url }
    if (run.conclusion !== 'success') return { status: 'failed', runId: run.id, conclusion: run.conclusion, url: run.html_url }
    const jobs = readPublicationApi(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`).flatMap(page => page.jobs)
    assert.ok(jobs.length && jobs.every(job => ['success', 'skipped'].includes(job.conclusion)), 'A publisher has failed or incomplete jobs.')
    assert.ok(jobs.some(job => job.conclusion === 'success'), 'Publisher acceptance cannot be entirely skipped.')
    return { status: 'verified', runId: run.id, url: run.html_url }
  }
  return {
    async release(identity) {
      let release, reference
      try { release = api(`releases/tags/${tag}`); reference = api(`git/ref/tags/${tag}`).object }
      catch (error) { if (missing(error)) return { status: 'missing' }; throw error }
      for (let i = 0; reference.type === 'tag' && i < 4; i++) reference = api(`git/tags/${reference.sha}`).object
      if (reference.type !== 'commit' || reference.sha !== source || release.tag_name !== tag || release.draft || release.prerelease || !release.published_at) {
        return { status: 'conflict', detail: 'Release/tag identity differs from the frozen source.' }
      }
      if (hashBytes(release.body || '') !== identity.documentation.sha256) return { status: 'conflict', detail: 'Published notes differ from the frozen document.' }
      return { status: 'verified', releaseId: release.id, url: release.html_url }
    },
    async oci(target) {
      let digest
      try { digest = command('oras', ['resolve', target.reference]) }
      catch (error) { if (missing(error)) return { status: 'missing' }; throw error }
      if (digest !== target.expectedDigest) return { status: target.mutable ? 'missing' : 'conflict', digest, expectedDigest: target.expectedDigest }
      if (target.reference.startsWith('ghcr.io/')) {
        const subject = `${target.reference.slice(0, target.reference.lastIndexOf(':'))}@${digest}`
        if (!signatures.has(subject)) { signature(subject); signatures.add(subject) }
      }
      return { status: 'verified', digest }
    },
    async package(target) {
      const published = await registry.describe(`${target.name}@${target.version}`)
      if (!published) return { status: 'missing' }
      const expected = await canonicalPackageDigest(join(artifacts, target.path))
      return { status: published.contentDigest === expected ? 'verified' : 'conflict', contentDigest: published.contentDigest, expectedContentDigest: expected }
    },
    async distribution() {
      const reference = `ghcr.io/enterpriseglue/releases/enterpriseglue-oss-distribution:${tag}`
      let digest
      try { digest = command('oras', ['resolve', reference]) }
      catch (error) { if (missing(error)) return { status: 'missing' }; throw error }
      const subject = `${reference.slice(0, reference.lastIndexOf(':'))}@${digest}`
      signature(subject)
      const manifest = JSON.parse(command('oras', ['manifest', 'fetch', subject]))
      const layers = manifest.layers.filter(layer => layer.mediaType === 'application/vnd.enterpriseglue.distribution-lock.v1+json')
      assert.equal(layers.length, 1)
      const directory = join(evidence, 'distribution')
      mkdirSync(directory, { recursive: true })
      const file = join(directory, 'published-lock.json')
      command('oras', ['blob', 'fetch', '--output', file, `${subject.split('@')[0]}@${layers[0].digest}`])
      const lock = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(lock.sourceRevision, source)
      assert.equal(lock.version, tag.slice(1))
      const expected = name => record.identity.targets.find(target => target.name === name).expectedDigest
      for (const name of ['backend', 'frontend']) assert.ok(lock.application[name].subject.endsWith(`@${expected(name)}`))
      for (const [name, value] of [['pluginInstaller', lock.pluginToolchain.installer], ['pluginManager', lock.pluginToolchain.manager],
        ['runtimeChart', lock.pluginToolchain.runtimeChart.subject], ['installerRbacChart', lock.pluginToolchain.installerRbacChart.subject],
        ['managerChart', lock.pluginToolchain.managerChart.subject]]) assert.ok(value.endsWith(`@${expected(name)}`))
      command('gh', ['release', 'download', tag, '--repo', repository, '--pattern', `enterpriseglue-*${tag}*`, '--dir', directory, '--clobber'])
      command('node', ['scripts/enterpriseglue-distribution-lock.mjs', 'verify', '--lock', file, '--root', directory])
      assert.ok(readFileSync(join(directory, `enterpriseglue-plugin-toolchain-airgap-${tag}.tar.gz`)).length)
      return { status: 'verified', digest, sourceRef: source }
    },
    workflow,
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [recordFile, artifacts, output, resume = 'false'] = argv
  assert.ok(recordFile && artifacts && output, 'Usage: release-publication-observe.mjs <record> <candidate-directory> <output> [true|false]')
  assert.ok(['true', 'false'].includes(resume))
  const record = JSON.parse(readFileSync(recordFile, 'utf8'))
  const evidence = join(resolve(output, '..'), 'observation-evidence')
  mkdirSync(evidence, { recursive: true })
  const observed = await observePublication(record, productionObservers({ record, artifacts, evidence }))
  writeFileSync(output, `${JSON.stringify(observed, null, 2)}\n`)
  if (resume === 'true') {
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch')
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
    const authorization = JSON.parse(readFileSync(process.env.RELEASE_RECOVERY_AUTHORIZATION, 'utf8'))
    assert.equal(authorization.sourceRef, record.identity.sourceRef)
    assert.equal(authorization.releaseTag, record.identity.releaseTag)
    assert.equal(authorization.documentation.sha256, record.identity.documentation.sha256)
    assert.equal(authorization.controlRef, process.env.GITHUB_SHA)
    observed.recoveryRequests = await resumePublication(observed, { explicitRecovery: true, dispatch: async (publisher, inputs) => {
      execFileSync('gh', ['api', '--method', 'POST', `repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/${publisher}/dispatches`,
        '--input', '-'], { input: JSON.stringify({ ref: 'main', inputs }), encoding: 'utf8' })
    } })
    writeFileSync(output, `${JSON.stringify(observed, null, 2)}\n`)
  }
  console.log(`[release-publication] observed state=${observed.state}; recovery requests=${observed.recoveryRequests?.length || 0}`)
  if (observed.observations.some(({ status }) => ['unknown', 'conflict'].includes(status))) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  main().catch(error => { console.error(`[release-publication] ${error.message}`); process.exitCode = 1 })
}
