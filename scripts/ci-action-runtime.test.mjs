import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const workflowDirectory = new URL('../.github/workflows/', import.meta.url)

const node24ActionPins = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/cache', '55cc8345863c7cc4c66a329aec7e433d2d1c52a9'],
  ['actions/download-artifact', '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  ['actions/github-script', '3a2844b7e9c422d3c10d287c895573f7108da1b3'],
  ['azure/setup-helm', '9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310'],
  ['docker/setup-buildx-action', '37fe631027851001ddb9b187196cc803df7f5f0e'],
  ['docker/build-push-action', '53b7df96c91f9c12dcc8a07bcb9ccacbed38856a'],
  ['docker/login-action', 'dbcb813823bdd20940b903addbd779551569679f'],
  ['docker/setup-qemu-action', '96fe6ef7f33517b61c61be40b68a1882f3264fb8'],
  ['pnpm/action-setup', '0977fd99725f1db4007ccb2928dbb4e90d06cc86'],
  ['github/codeql-action', 'cdf488f595d80d6e07e03d4674febd5ab45fa938'],
  ['googleapis/release-please-action', '45996ed1f6d02564a971a2fa1b5860e934307cf7'],
  ['oras-project/setup-oras', '1d808f7d7f6995cc68b7bf507bfe5c5446e1dc9d'],
  ['peter-evans/create-pull-request', '5f6978faf089d4d20b00c7766989d076bb2fc7f1'],
  ['peter-evans/repository-dispatch', '28959ce8df70de7be546dd1250a005dd32156697'],
  ['aquasecurity/setup-trivy', '81e514348e19b6112ce2a7e3ecbafe19c1e1f567'],
])

const retiredNode20Actions = new Set([
  'aquasecurity/trivy-action',
  'redhat-actions/oc-installer',
])

function actionRepository(action) {
  if (action.startsWith('github/codeql-action/')) return 'github/codeql-action'
  return action
}

test('workflows use the approved Node 24 action revisions', async () => {
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => name.endsWith('.yml'))
    .sort()
  const violations = []
  let checkedReferences = 0

  for (const workflowName of workflowNames) {
    const workflow = await readFile(new URL(workflowName, workflowDirectory), 'utf8')
    for (const match of workflow.matchAll(/^\s*uses:\s*([^\s@]+)@([^\s#]+)/gm)) {
      const [, action, revision] = match
      if (!/^[a-f0-9]{40}$/.test(revision)) {
        violations.push(`${path.basename(workflowName)}: unpinned ${action}@${revision}`)
        continue
      }
      const repository = actionRepository(action)
      if (retiredNode20Actions.has(repository)) {
        violations.push(`${path.basename(workflowName)}: retired ${action}@${revision}`)
        continue
      }
      const expectedRevision = node24ActionPins.get(repository)
      if (!expectedRevision) continue
      checkedReferences += 1
      if (revision !== expectedRevision) {
        violations.push(`${path.basename(workflowName)}: ${action}@${revision}`)
      }
    }
  }

  assert.ok(checkedReferences > 0, 'expected to inspect Node-based workflow actions')
  assert.deepEqual(
    violations,
    [],
    `Node 24 action pins drifted:\n${violations.join('\n')}`,
  )
})
