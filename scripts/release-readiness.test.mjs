import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const preflight = await readFile(
  new URL('../.github/workflows/release-notes-preflight-reusable.yml', import.meta.url),
  'utf8',
)
const detect = await readFile(
  new URL('../.github/workflows/ci-detect-reusable.yml', import.meta.url),
  'utf8',
)
const readiness = await readFile(
  new URL('./check-release-candidate-readiness.sh', import.meta.url),
  'utf8',
)
const chartPlan = await readFile(
  new URL('./plan-plugin-toolchain-charts.sh', import.meta.url),
  'utf8',
)
const productionImages = await readFile(
  new URL('./check-plugin-platform-production-images.sh', import.meta.url),
  'utf8',
)
const toolchainLocal = await readFile(
  new URL('./check-plugin-toolchain-oci-local.sh', import.meta.url),
  'utf8',
)

test('release candidate detection works for pull requests, manual runs, and merge groups', () => {
  assert.match(preflight, /is_release_pull_request:/)
  assert.match(preflight, /startsWith\(steps\.pull_request\.outputs\.head_ref, 'release-please--branches--'\)/)
  assert.match(preflight, /steps\.pull_request\.outputs\.head_repository == github\.repository/)
  assert.match(preflight, /context\.eventName === 'workflow_dispatch'/)
  assert.match(preflight, /github\.rest\.pulls\.list/)
  assert.match(preflight, /head: `\$\{context\.repo\.owner\}:\$\{branch\}`/)
  assert.match(detect, /run_release_readiness/)
  assert.match(detect, /check-release-candidate-readiness/)
})

test('the release-readiness CI job is read-only and part of the aggregate', () => {
  const start = ci.indexOf('  release-readiness:\n')
  const end = ci.indexOf('\n  ci-complete:\n', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const job = ci.slice(start, end)
  assert.match(job, /name: Release candidate readiness/)
  assert.match(job, /packages: read/)
  assert.doesNotMatch(job, /packages: write/)
  assert.match(job, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(job, /pnpm run test:release-readiness/)
  assert.match(job, /PLUGIN_PLATFORM_BUILDX_BUILDER: \$\{\{ steps\.release-buildx\.outputs\.name \}\}/)
  assert.match(ci, /      - release-readiness/)
})

test('readiness covers immutable package, chart, image, scan, and receipt gates', () => {
  assert.match(readiness, /check-published-package-version-discipline/)
  assert.match(readiness, /publish-plugin-package-set\.mjs plan/)
  assert.match(readiness, /publish-plugin-package-set\.mjs dry-run/)
  assert.match(readiness, /plan-plugin-toolchain-charts\.sh/)
  assert.match(readiness, /check-plugin-platform-production-images\.sh/)
  assert.match(readiness, /test:plugin-toolchain-release:local/)
  assert.match(readiness, /publicationPerformed: false/)
})

test('the real chart registry plan cannot publish', () => {
  assert.match(chartPlan, /oras resolve/)
  assert.equal([...chartPlan.matchAll(/helm-chart-archive\.mjs" compare/g)].length, 2)
  assert.doesNotMatch(chartPlan, /sha256_file "\$repro_archive"/)
  assert.doesNotMatch(chartPlan, /helm push/)
  assert.doesNotMatch(chartPlan, /oras push/)
})

test('the production image gate scans every release image', () => {
  assert.match(productionImages, /for platform in linux\/amd64 linux\/arm64/)
  assert.equal([...productionImages.matchAll(/--load --quiet/g)].length, 4)
  assert.match(
    productionImages,
    /for image in "\$BACKEND_IMAGE" "\$FRONTEND_IMAGE" "\$INSTALLER_IMAGE" "\$MANAGER_IMAGE"/,
  )
  assert.match(productionImages, /--severity HIGH,CRITICAL/)
})

test('the local OCI drill preloads its immutable disposable registry image', () => {
  assert.match(
    toolchainLocal,
    /ZOT_IMAGE="\$\{EG_PLUGIN_TOOLCHAIN_ZOT_IMAGE:-ghcr\.io\/project-zot\/zot-minimal@sha256:[a-f0-9]{64}\}"/,
  )
  assert.match(toolchainLocal, /docker pull "\$ZOT_IMAGE"/)
  assert.equal([...toolchainLocal.matchAll(/--pull=never/g)].length, 2)
  assert.match(toolchainLocal, /docker buildx build/)
  assert.match(toolchainLocal, /--provenance=false/)
  assert.match(toolchainLocal, /--sbom=false/)
  assert.match(toolchainLocal, /--output "type=oci,dest=\$INSTALLER_OCI_LAYOUT"/)
  assert.match(toolchainLocal, /oras manifest fetch --oci-layout "\$INSTALLER_OCI_LAYOUT_REFERENCE"/)
  assert.match(toolchainLocal, /oras cp/)
  assert.match(toolchainLocal, /--from-oci-layout/)
  assert.match(toolchainLocal, /--to-plain-http/)
  assert.doesNotMatch(toolchainLocal, /docker push "\$INSTALLER_TAG"/)
  assert.equal([...toolchainLocal.matchAll(/helm-chart-archive\.mjs" compare/g)].length, 2)
  assert.doesNotMatch(toolchainLocal, /sha256_file "\$REPRO_OUTPUT/)
})
