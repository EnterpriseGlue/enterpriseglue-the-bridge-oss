import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')

const [
  stage,
  docker,
  dockerReusable,
  hostChart,
  toolchain,
  packages,
  fetchCandidate,
  detect,
  releasePlease,
  autoMerge,
  releaseAutopilot,
] = await Promise.all([
  read('../.github/workflows/release-candidate-stage.yml'),
  read('../.github/workflows/docker-images.yml'),
  read('../.github/workflows/docker-images-reusable.yml'),
  read('../.github/workflows/host-chart-release.yml'),
  read('../.github/workflows/plugin-toolchain-release.yml'),
  read('../.github/workflows/plugin-package-release.yml'),
  read('./fetch-release-candidate.sh'),
  read('../.github/workflows/ci-detect-reusable.yml'),
  read('../.github/workflows/release-please.yml'),
  read('../.github/workflows/auto-merge-label.yml'),
  read('../.github/workflows/release-autopilot-reusable.yml'),
])

test('candidate staging is downstream of successful exact merge-queue CI', () => {
  assert.match(stage, /workflow_run:\n\s+workflows: \[CI\]/)
  assert.match(stage, /run\.event !== 'merge_group'/)
  assert.match(stage, /run\.conclusion !== 'success'/)
  assert.match(stage, /release-please--branches--/)
  assert.match(stage, /context: 'Release candidate staged'/)
  assert.match(stage, /candidate-\$\{releaseTag\}-\$\{sourceRef\.slice\(0, 12\)\}/)
  assert.match(stage, /Privileged candidate staging accepts only the exact generated Release Please delta/)
  assert.match(stage, /pull\.base\?\.sha/)
  assert.match(stage, /baseRef !== context\.sha/)
  assert.match(stage, /commit\.parents\?\.\[0\]\?\.sha !== baseRef/)
})

test('candidate staging never executes the merge-queue checkout with write authority', () => {
  const validator = stage.slice(
    stage.indexOf('  validate-source:\n'),
    stage.indexOf('  stage-application-images:\n'),
  )
  assert.match(validator, /permissions:\n\s+contents: read/)
  assert.match(validator, /compareCommitsWithBasehead/)
  assert.match(validator, /github\.rest\.repos\.getContent/)
  assert.doesNotMatch(validator, /actions\/checkout/)
  assert.doesNotMatch(stage, /^\s+ref: \$\{\{ needs\.resolve\.outputs\.source_ref \}\}$/gm)
  assert.doesNotMatch(stage, /release-candidate-overlay/)
  assert.match(stage, /candidateChart !== expectedChart/)
  assert.match(stage, /Derive the validated host-chart release metadata/)
  assert.match(stage, /sync-host-chart-release-version\.mjs/)
  assert.match(stage, /derive_release_metadata == 'true'/)
  assert.doesNotMatch(dockerReusable, /checkout_ref:/)
  const checkout = dockerReusable.slice(
    dockerReusable.indexOf('      - name: Checkout\n'),
    dockerReusable.indexOf('      - name: Set up QEMU\n'),
  )
  assert.doesNotMatch(checkout, /ref:/)
})

test('auto-merge preserves the qualified merge-group commit identity', () => {
  assert.match(autoMerge, /merge-method: merge/)
  assert.doesNotMatch(autoMerge, /merge-method: squash/)
  assert.match(releaseAutopilot, /merge-method: merge/)
  assert.doesNotMatch(releaseAutopilot, /merge-method: squash/)
})

test('candidate staging qualifies every public artifact before recording success', () => {
  for (const job of [
    'validate-source',
    'stage-application-images',
    'qualify-application-images',
    'stage-toolchain',
    'publish-receipt',
  ]) {
    assert.match(stage, new RegExp(`\\b${job}\\b`))
  }
  assert.match(stage, /smoke-images-local\.sh/)
  assert.match(stage, /--force-oracle/)
  assert.match(stage, /--severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN/)
  assert.match(stage, /--volume "\$GITHUB_WORKSPACE\/\.trivyignore:\/workspace\/\.trivyignore:ro"/)
  assert.match(stage, /--ignorefile \/workspace\/\.trivyignore/)
  assert.match(stage, /plugin-installer:\$installer_version-\$SOURCE_REF/)
  assert.match(stage, /release-candidates\/charts\/enterpriseglue-host/)
  assert.match(stage, /helm-chart-archive\.mjs compare "\$archive" "\$pulled" >&2/)
  assert.match(stage, /release-candidate-receipt\.mjs create/)
  assert.match(stage, /cosign verify/)
  assert.match(stage, /results\.every\(\(result\) => result === 'success'\)/)
})

test('candidate package planning authenticates to GitHub Packages', () => {
  const toolchainStage = stage.slice(
    stage.indexOf('  stage-toolchain:\n'),
    stage.indexOf('\n  publish-receipt:\n'),
  )
  assert.match(
    toolchainStage,
    /name: Set up Node\.js and GitHub Packages[\s\S]*registry-url: https:\/\/npm\.pkg\.github\.com[\s\S]*scope: "@enterpriseglue"/,
  )
  assert.match(
    toolchainStage,
    /name: Stage immutable toolchain artifacts[\s\S]*NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}[\s\S]*publish-plugin-package-set\.mjs plan/,
  )
})

test('application release publication promotes candidate digests and delays aliases', () => {
  assert.match(dockerReusable, /source_ref:/)
  assert.match(dockerReusable, /image_version:/)
  assert.match(dockerReusable, /org\.opencontainers\.image\.revision=\$\{\{ steps\.meta\.outputs\.source_revision \}\}/)
  assert.match(docker, /mode="promote"/)
  assert.match(docker, /fetch-release-candidate\.sh/)
  assert.match(docker, /Promote without rebuilding/)
  assert.match(docker, /Immutable release tag \$target already points at/)
  const aliases = docker.slice(docker.indexOf('  promote-public-aliases:\n'))
  const jobSection = (job) => {
    const marker = `\n  ${job}:\n`
    const start = docker.indexOf(marker)
    assert.ok(start >= 0, `missing ${job} job`)
    const tail = docker.slice(start + marker.length)
    const nextJob = tail.search(/\n  [a-z0-9][a-z0-9-]*:\n/)
    return nextJob >= 0 ? tail.slice(0, nextJob) : tail
  }
  for (const gate of [
    'smoke-postgres-image-deploy',
    'smoke-postgres-image-deploy-exposed',
    'smoke-oracle-image-deploy',
    'security-published-scan',
  ]) {
    const section = jobSection(gate)
    assert.match(section, /needs: publish/)
    assert.match(section, /if:[\s\S]{0,160}always\(\)[\s\S]{0,160}needs\.publish\.result == 'success'/)
    assert.match(aliases, new RegExp(`needs\\.${gate}\\.result == 'success'`))
  }
  assert.match(aliases, /dockerhub_backend:\$RELEASE_TAG/)
  assert.match(aliases, /\$BACKEND_IMAGE:latest/)
})

test('Release Please fails closed before creating a tag without a signed candidate', () => {
  const verify = releasePlease.indexOf('      - name: Verify signed candidate before tag creation\n')
  const release = releasePlease.indexOf('      - name: Run Release Please\n')
  assert.ok(verify > 0)
  assert.ok(release > verify)
  assert.match(releasePlease, /bash scripts\/fetch-release-candidate\.sh "\$GITHUB_SHA" "\$RELEASE_TAG"/)
  assert.match(releasePlease, /packages: read/)
  assert.match(releasePlease, /git log -1 --format=%B/)
  assert.equal(
    releasePlease.match(/match\(\/\^chore\\\(main\\\)!\?: release .*\\s\*\$\/m\)/g)?.length,
    2,
    'release-note publication and release existence checks must recognize a release title in a merge commit body',
  )
})

test('charts and packages consume the signed candidate with a legacy recovery boundary', () => {
  assert.match(fetchCandidate, /cosign verify/)
  assert.match(fetchCandidate, /release-candidate-receipt\.mjs" verify/)
  assert.match(hostChart, /fetch-release-candidate\.sh/)
  assert.match(hostChart, /oras cp -r "\$candidate_subject" "\$CHART_REPOSITORY:\$CHART_VERSION"/)
  assert.match(hostChart, /LEGACY_RELEASE_WITHOUT_CANDIDATE=true/)
  assert.match(toolchain, /fetch-release-candidate\.sh/)
  assert.match(toolchain, /Bind toolchain images to the qualified candidate/)
  assert.match(toolchain, /oras cp -r "\$candidate_subject" "\$repository:\$version"/)
  assert.match(packages, /cp "\$CANDIDATE_PAYLOAD"\/packages\/\*\.tgz/)
  assert.match(packages, /New package publications require the signed candidate release_tag/)
})

test('candidate pipeline changes always re-run release readiness', () => {
  assert.match(detect, /release-candidate-stage/)
  assert.match(detect, /release-candidate-receipt/)
  assert.match(detect, /fetch-release-candidate/)
})
