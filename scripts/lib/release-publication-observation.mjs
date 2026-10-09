import assert from 'node:assert/strict'
import { observedState, publicationRecoveryPlan, validatePublicationRecord } from './release-publication-record.mjs'

export async function observePublication(record, adapters) {
  validatePublicationRecord(record)
  const observations = []
  const observe = async (name, publisher, operation) => {
    try { observations.push({ name, publisher, ...await operation() }) }
    catch (error) { observations.push({ name, publisher, status: error.publicationStatus || 'unknown', detail: error.message }) }
  }
  await observe('github-release', '', () => adapters.release(record.identity))
  for (const target of record.identity.targets) {
    await observe(target.name, target.publisher, () => adapters[target.kind](target))
  }
  await observe('distribution', 'plugin-toolchain-release.yml', () => adapters.distribution(record.identity))
  for (const publisher of [...new Set(record.identity.targets.map(({ publisher }) => publisher))]) {
    await observe(`workflow:${publisher}`, publisher, () => adapters.workflow(publisher, record))
  }
  const result = { ...record, state: observedState(observations), observations }
  validatePublicationRecord(result)
  return result
}

export async function resumePublication(record, { explicitRecovery = false, dispatch }) {
  assert.equal(explicitRecovery, true, 'Only an explicitly authorized recovery can dispatch publishers.')
  const plan = publicationRecoveryPlan(record)
  assert.equal(record.observations.find(({ name }) => name === 'github-release')?.status, 'verified',
    'The immutable GitHub release must exist before recovering downstream publishers.')
  // Dependency publications precede host publications. Image success also
  // triggers toolchain publication; its idempotent manual recovery is supported.
  const order = ['plugin-package-release.yml', 'host-package-release.yml', 'docker-images.yml', 'host-chart-release.yml', 'plugin-toolchain-release.yml']
  const requests = []
  for (const publisher of order.filter(name => plan.includes(name))) {
    if (record.observations.some(item => item.publisher === publisher && item.status === 'pending')) continue
    if (publisher === 'plugin-toolchain-release.yml' && requests.some(request => request.publisher === 'docker-images.yml')) continue
    const inputs = { source_ref: record.identity.sourceRef, release_tag: record.identity.releaseTag }
    if (publisher === 'plugin-package-release.yml') inputs.dry_run = 'false'
    await dispatch(publisher, inputs)
    requests.push({ publisher, inputs })
  }
  return requests
}
