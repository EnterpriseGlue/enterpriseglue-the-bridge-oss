import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { classifyChangedFiles } from './ci-change-classifier.mjs'

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
const releaseNotify = await readFile(
  new URL('../.github/workflows/release-notify.yml', import.meta.url),
  'utf8',
)

test('published OSS releases wake fixed cloud staging reconciliation', () => {
  for (const boundary of [
    'types:\n      - published',
    'release_tag:',
    'if: github.event_name == \'release\'',
    'name: Wake cloud staging demo reconciliation',
    'if: always()',
    'github-token: ${{ secrets.RELEASE_PLEASE_TOKEN }}',
    'github.rest.repos.getReleaseByTag',
    "release.draft || release.prerelease || !release.published_at",
    'github.rest.git.getRef',
    'github.rest.git.getTag',
    "repo: 'enterpriseglue-cloud'",
    "event_type: 'enterpriseglue-oss-release-published'",
  ]) assert.ok(releaseNotify.includes(boundary), `missing staging notification boundary: ${boundary}`)
  assert.doesNotMatch(releaseNotify, /production-deploy|deploy-production/)
})

test('release candidate detection works for pull requests, manual runs, and merge groups', () => {
  assert.match(preflight, /is_release_pull_request:/)
  assert.match(preflight, /startsWith\(steps\.pull_request\.outputs\.head_ref, 'release-please--branches--'\)/)
  assert.match(preflight, /steps\.pull_request\.outputs\.head_repository == github\.repository/)
  assert.match(preflight, /context\.eventName === 'workflow_dispatch'/)
  assert.match(preflight, /github\.rest\.pulls\.list/)
  assert.match(preflight, /head: `\$\{context\.repo\.owner\}:\$\{branch\}`/)
  assert.match(detect, /run_release_readiness/)
  const classification = classifyChangedFiles(['scripts/check-release-candidate-readiness.sh'])
  assert.equal(classification.workflow_or_release, true)
  assert.equal(classification.run_release_readiness, true)
})

test('the release-readiness CI job is read-only, contract-scoped, and part of the aggregate', () => {
  const start = ci.indexOf('  release-readiness:\n')
  const end = ci.indexOf('\n  ci-complete:\n', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const job = ci.slice(start, end)
  assert.match(job, /name: Release candidate readiness/)
  assert.match(job, /packages: read/)
  assert.doesNotMatch(job, /packages: write/)
  assert.match(job, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(job, /is_release_pull_request != 'true'/)
  assert.doesNotMatch(job, /is_release_pull_request == 'true'/)
  assert.match(job, /github\.event_name == 'pull_request'/)
  assert.match(job, /pnpm run test:release-readiness/)
  assert.match(job, /PLUGIN_PLATFORM_BUILDX_BUILDER: \$\{\{ steps\.release-buildx\.outputs\.name \}\}/)
  assert.match(ci, /      - release-readiness/)
  assert.match(
    ci,
    /CI_REQUIRED_NON_SKIPPED_JOBS: \$\{\{ .*is_release_pull_request != 'true' && needs\.detect\.outputs\.run_release_readiness == 'true' && \(github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository\)\)/,
  )
})

test('Release Please heads and merge groups do not duplicate candidate staging qualification', () => {
  const start = ci.indexOf('  release-readiness:\n')
  const end = ci.indexOf('\n  ci-complete:\n', start)
  const job = ci.slice(start, end)
  assert.match(job, /needs\.release-notes-preflight\.outputs\.is_release_pull_request != 'true'/)
  assert.doesNotMatch(job, /github\.event_name == 'merge_group'/)
  assert.match(ci, /Release Candidate Stage qualifies/)
})

test('readiness covers immutable package, chart, image, scan, and receipt gates', () => {
  assert.match(readiness, /check-published-package-version-discipline/)
  assert.match(readiness, /publish-plugin-package-set\.mjs plan/)
  assert.match(readiness, /publish-plugin-package-set\.mjs dry-run/)
  assert.match(readiness, /verify-host-package-tarballs\.mjs/)
  assert.match(readiness, /publish-host-package-set\.mjs plan/)
  assert.match(readiness, /publish-host-package-set\.mjs dry-run/)
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
  assert.match(productionImages, /PLUGIN_PLATFORM_TRIVY_CACHE_DIR/)
  assert.match(productionImages, /docker volume create "\$TRIVY_CACHE_SOURCE"/)
  assert.match(productionImages, /docker volume rm --force "\$TRIVY_CACHE_SOURCE"/)
  assert.match(productionImages, /\/root\/\.cache\/trivy/)
  assert.match(productionImages, /--severity HIGH,CRITICAL/)
  assert.match(productionImages, /if \[\[ "\$image" == "\$BACKEND_IMAGE" \|\| "\$image" == "\$FRONTEND_IMAGE" \]\]/)
  assert.match(productionImages, /--severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN --ignorefile \/workspace\/\.trivyignore/)
  assert.match(productionImages, /"\$\{scan_args\[@\]\}" "\$image"/)
  assert.match(readiness, /applicationVulnerabilityScan: "CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN"/)
})

test('patches the production zlib runtime before accepting the temporary scanner metadata exception', async () => {
  const [dockerfile, securityPatch, trivyIgnore] = await Promise.all([
    readFile(new URL('../backend/Dockerfile.prod', import.meta.url), 'utf8'),
    readFile(new URL('../backend/patches/zlib/CVE-2026-85091.patch', import.meta.url), 'utf8'),
    readFile(new URL('../.trivyignore', import.meta.url), 'utf8'),
  ])

  assert.match(
    dockerfile,
    /ADD --checksum=sha256:bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16[\s\S]*zlib-1\.3\.2\.tar\.gz/,
    'the security rebuild must consume the checksum-pinned upstream release archive',
  )
  assert.match(
    dockerfile,
    /ADD --checksum=sha256:f3bde5714d3ae4ab735f9628827180af5683bb864370456364f4b143815c06ad[\s\S]*madler\/zlib\/4d03c63b8648ab83053a6f00d304a5d6f9aa1ed7\/test\/gznonblock\.c/,
    'the security rebuild must run the checksum-pinned upstream regression source',
  )
  assert.match(dockerfile, /patch --strip=1 < \/tmp\/CVE-2026-85091\.patch/)
  assert.match(dockerfile, /CFLAGS="-fsanitize=address,undefined -fno-sanitize-recover=all -O1 -g"/)
  assert.match(dockerfile, /-I\. test\/gznonblock\.c libz\.a -o \/tmp\/gznonblock/)
  assert.match(dockerfile, /ASAN_OPTIONS=detect_leaks=0 \/tmp\/gznonblock/)
  assert.match(dockerfile, /make test/)
  assert.match(
    dockerfile,
    /COPY --from=zlib-security-build --chown=0:0[\s\S]*\/patched-zlib\/usr\/lib\/libz\.so\.1\.3\.2[\s\S]*\/usr\/lib\/libz\.so\.1\.3\.2/,
    'the final runtime must replace the vulnerable shared-library bytes',
  )
  assert.match(securityPatch, /Upstream-Commit: https:\/\/github\.com\/madler\/zlib\/commit\/4d03c63b8648ab83053a6f00d304a5d6f9aa1ed7/)
  assert.equal((securityPatch.match(/^\+\s+state->strm\.next_in = Z_NULL;$/gm) ?? []).length, 2)
  assert.equal((securityPatch.match(/^\+\s+state->strm\.avail_in = 0;$/gm) ?? []).length, 1)
  assert.match(
    trivyIgnore,
    /owner: security-team \| reason: The final backend libz bytes are rebuilt[\s\S]*expires: 2026-10-15\nCVE-2026-85091/,
    'the scanner metadata exception must remain owned, justified, and time bounded',
  )
})

test('local scanner actually applies the candidate threshold to each image type', () => {
  const start = productionImages.indexOf('for image in "$BACKEND_IMAGE" "$FRONTEND_IMAGE" "$INSTALLER_IMAGE" "$MANAGER_IMAGE"; do')
  const end = productionImages.indexOf('\ncleanup_trivy_cache', start)
  assert.ok(start >= 0 && end > start)
  const result = spawnSync('bash', ['-c', `
    set -euo pipefail
    BACKEND_IMAGE=backend FRONTEND_IMAGE=frontend INSTALLER_IMAGE=installer MANAGER_IMAGE=manager
    ROOT_DIR=/workspace TRIVY_CACHE_SOURCE=cache TRIVY_IMAGE=trivy
    docker() { printf '%s\\n' "$*"; }
    ${productionImages.slice(start, end)}
  `], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const calls = result.stdout.trim().split('\n')
  assert.equal(calls.length, 4)
  for (const [index, image] of ['backend', 'frontend', 'installer', 'manager'].entries()) {
    assert.match(calls[index], /image --quiet --exit-code 1/)
    if (index < 2) {
      assert.ok(calls[index].endsWith(`--severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN --ignorefile /workspace/.trivyignore ${image}`))
    } else {
      assert.ok(calls[index].endsWith(`--severity HIGH,CRITICAL ${image}`))
      assert.doesNotMatch(calls[index], /--ignorefile/)
    }
  }
})

test('the local OCI drill qualifies the complete toolchain and distribution lock', () => {
  assert.match(
    toolchainLocal,
    /ZOT_IMAGE="\$\{EG_PLUGIN_TOOLCHAIN_ZOT_IMAGE:-ghcr\.io\/project-zot\/zot-minimal@sha256:[a-f0-9]{64}\}"/,
  )
  assert.match(toolchainLocal, /docker pull "\$ZOT_IMAGE"/)
  assert.equal([...toolchainLocal.matchAll(/--pull=never/g)].length, 2)
  assert.equal([...toolchainLocal.matchAll(/docker buildx build/g)].length, 2)
  assert.match(toolchainLocal, /build_toolchain_image\(\)/)
  assert.doesNotMatch(toolchainLocal, /BUILDX_BUILDER_ARGS/)
  assert.match(toolchainLocal, /--provenance=false/)
  assert.match(toolchainLocal, /--sbom=false/)
  assert.match(toolchainLocal, /--output "type=oci,dest=\$INSTALLER_OCI_LAYOUT"/)
  assert.match(toolchainLocal, /--output "type=oci,dest=\$MANAGER_OCI_LAYOUT"/)
  assert.match(toolchainLocal, /oras manifest fetch --oci-layout "\$INSTALLER_OCI_LAYOUT_REFERENCE"/)
  assert.match(toolchainLocal, /oras manifest fetch --oci-layout "\$MANAGER_OCI_LAYOUT_REFERENCE"/)
  assert.equal([...toolchainLocal.matchAll(/oras cp/g)].length, 2)
  assert.match(toolchainLocal, /--from-oci-layout/)
  assert.match(toolchainLocal, /--to-plain-http/)
  assert.doesNotMatch(toolchainLocal, /docker push "\$INSTALLER_TAG"/)
  assert.doesNotMatch(toolchainLocal, /docker push "\$MANAGER_TAG"/)
  assert.equal([...toolchainLocal.matchAll(/helm-chart-archive\.mjs" compare/g)].length, 3)
  assert.match(toolchainLocal, /--arg managerVersion "\$MANAGER_VERSION"/)
  assert.match(toolchainLocal, /--arg manager "\$MANAGER_REFERENCE"/)
  assert.match(toolchainLocal, /--arg managerChart "\$MANAGER_CHART_REFERENCE"/)
  assert.match(toolchainLocal, /enterpriseglue-distribution-lock\.mjs" create/)
  assert.match(
    toolchainLocal,
    /oras push --plain-http "\$DISTRIBUTION_TAG"[\s\S]*--disable-path-validation[\s\S]*application\/vnd\.enterpriseglue\.distribution-lock\.v1\+json/,
  )
  assert.match(toolchainLocal, /oras resolve --plain-http "\$DISTRIBUTION_TAG"/)
  assert.match(toolchainLocal, /cmp --silent "\$DISTRIBUTION_LOCK" "\$DISTRIBUTION_PULLED"/)
  assert.match(toolchainLocal, /"\$DISTRIBUTION_REFERENCE" >\/dev\/null/)
  assert.match(toolchainLocal, /--arg distributionLock "\$DISTRIBUTION_REFERENCE"/)
  assert.match(toolchainLocal, /distributionLockDigestRepullVerified: true/)
  assert.match(toolchainLocal, /and \(\.artifacts \| length == 5\)/)
  assert.match(toolchainLocal, /for image in "\$TARGET_INSTALLER_REFERENCE" "\$TARGET_MANAGER_REFERENCE"/)
  assert.doesNotMatch(toolchainLocal, /sha256_file "\$REPRO_OUTPUT/)
})
