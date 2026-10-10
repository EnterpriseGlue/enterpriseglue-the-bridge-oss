import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const PUBLICATION_SCHEMA = 'enterpriseglue-release-publication/v1'
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const identityHash = identity => hashBytes(JSON.stringify(canonical(identity)))

export function publicationTargets(candidate, { dockerhubNamespace = '' } = {}) {
  const targets = []
  const add = (name, reference, expectedDigest, publisher, mutable = false) => targets.push({ name, kind: 'oci', reference, expectedDigest, publisher, mutable })
  const subject = role => candidate.subjects[role].subject
  const digest = role => subject(role).split('@')[1]
  const version = chart => {
    const found = candidate.artifacts.find(({ path }) => path.startsWith(`charts/${chart}-`))
    assert.ok(found, `Missing candidate chart ${chart}`)
    return found.path.slice(`charts/${chart}-`.length, -4)
  }
  for (const role of ['backend', 'frontend', 'managedShardBootstrap']) {
    const repository = subject(role).split('@')[0]
    add(role, `${repository}:${candidate.releaseTag}`, digest(role), 'docker-images.yml')
    if (role !== 'managedShardBootstrap') {
      add(`${role}-latest`, `${repository}:latest`, digest(role), 'docker-images.yml', true)
      if (dockerhubNamespace) {
        assert.match(dockerhubNamespace, /^[a-z0-9][a-z0-9_-]*$/)
        const docker = `docker.io/${dockerhubNamespace}/enterpriseglue-the-bridge-oss-${role}`
        add(`${role}-dockerhub`, `${docker}:${candidate.releaseTag}`, digest(role), 'docker-images.yml')
        add(`${role}-dockerhub-latest`, `${docker}:latest`, digest(role), 'docker-images.yml', true)
      }
    }
  }
  for (const [role, chart, publisher] of [
    ['hostChart', 'enterpriseglue-host', 'host-chart-release.yml'],
    ['runtimeChart', 'enterpriseglue-plugin-runtime', 'plugin-toolchain-release.yml'],
    ['installerRbacChart', 'enterpriseglue-plugin-installer-rbac', 'plugin-toolchain-release.yml'],
    ['managerChart', 'enterpriseglue-plugin-manager', 'plugin-toolchain-release.yml'],
  ]) add(role, `ghcr.io/enterpriseglue/charts/${chart}:${version(chart)}`, digest(role), publisher)
  for (const [role, chart, repository] of [
    ['pluginInstaller', 'enterpriseglue-plugin-runtime', 'plugin-installer'],
    ['pluginManager', 'enterpriseglue-plugin-manager', 'plugin-manager'],
  ]) add(role, `ghcr.io/enterpriseglue/${repository}:${version(chart)}-${candidate.sourceRevision}`, digest(role), 'plugin-toolchain-release.yml')
  for (const { path } of candidate.artifacts.filter(({ path }) => path.startsWith('packages/'))) {
    const match = path.match(/\/enterpriseglue-(.+)-(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\.tgz$/)
    assert.ok(match, `Invalid candidate package ${path}`)
    targets.push({ name: `@enterpriseglue/${match[1]}`, kind: 'package', version: match[2], path,
      publisher: path.startsWith('packages/host/') ? 'host-package-release.yml' : 'plugin-package-release.yml' })
  }
  assert.equal(targets.filter(target => target.kind === 'package').length, 8)
  return targets
}

export function createPublicationRecord({ authorization, candidate, candidateRef, dockerhubNamespace = '' }) {
  assert.equal(candidate.status, 'qualified')
  assert.equal(candidate.sourceRevision, authorization.sourceRef)
  assert.equal(candidate.releaseTag, authorization.releaseTag)
  assert.match(candidateRef, /^ghcr\.io\/enterpriseglue\/enterpriseglue-oss-release-candidate@sha256:[a-f0-9]{64}$/)
  assert.match(authorization.documentation.sha256, /^[a-f0-9]{64}$/)
  const identity = { sourceRef: authorization.sourceRef, releaseTag: authorization.releaseTag,
    releasePR: authorization.releasePR, requiredPRs: [...authorization.requiredPRs].sort((a, b) => a - b),
    previousTag: authorization.previousTag, documentation: authorization.documentation, candidateRef,
    artifacts: candidate.artifacts, targets: publicationTargets(candidate, { dockerhubNamespace }),
    dockerhub: dockerhubNamespace ? { required: true, namespace: dockerhubNamespace } : { required: false, reason: 'Docker Hub publication credentials or namespace are not configured.' } }
  return { schemaVersion: PUBLICATION_SCHEMA, identity, identityHash: identityHash(identity), state: 'approved',
    authorization: { controlRef: authorization.controlRef, recoveryPRs: authorization.recoveryPRs,
      requestedBy: authorization.requestedBy, workflowRun: authorization.workflowRun }, observations: [] }
}

export function validatePublicationRecord(record) {
  assert.equal(record.schemaVersion, PUBLICATION_SCHEMA)
  assert.match(record.identity.sourceRef, /^[a-f0-9]{40}$/)
  assert.match(record.identity.releaseTag, /^v\d+\.\d+\.\d+$/)
  assert.equal(record.identityHash, identityHash(record.identity), 'Publication identity was changed.')
  assert.ok(['qualified', 'approved', 'publishing', 'partially-published', 'published'].includes(record.state))
  assert.ok(Array.isArray(record.observations))
  if (record.observations.length) {
    const expected = ['github-release', 'distribution', ...record.identity.targets.map(({ name }) => name),
      ...[...new Set(record.identity.targets.map(({ publisher }) => publisher))].map(publisher => `workflow:${publisher}`)].sort()
    assert.deepEqual(record.observations.map(({ name }) => name).sort(), expected, 'Publication observations must cover every destination and publisher exactly once.')
  }
  if (record.state === 'published') assert.equal(observedState(record.observations), 'published', 'Published requires complete verified destinations.')
  return record
}

export function assertSamePublication(existing, proposed) {
  validatePublicationRecord(existing)
  validatePublicationRecord(proposed)
  assert.equal(existing.identityHash, proposed.identityHash, 'A retry cannot change the release batch, candidate, documentation or destinations.')
}

export function observedState(observations) {
  assert.ok(observations.length > 0, 'Publication observation inventory is missing.')
  if (observations.every(({ status }) => status === 'verified')) return 'published'
  return observations.some(({ status }) => status === 'verified') ? 'partially-published' : 'approved'
}

export function publicationRecoveryPlan(record) {
  validatePublicationRecord(record)
  const publishers = new Set()
  for (const observation of record.observations) {
    assert.ok(['verified', 'missing', 'pending', 'failed', 'conflict', 'unknown'].includes(observation.status))
    assert.notEqual(observation.status, 'conflict', `Immutable conflict at ${observation.name}; a retry must not overwrite it.`)
    assert.notEqual(observation.status, 'unknown', `Unresolved observation at ${observation.name}; diagnose before writing.`)
    if (observation.status !== 'verified' && observation.publisher) publishers.add(observation.publisher)
  }
  return [...publishers]
}
