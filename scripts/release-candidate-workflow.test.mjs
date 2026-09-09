import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { classifyChangedFiles } from './ci-change-classifier.mjs'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const artifactHelper = await read('./release-candidate-artifacts.sh')

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

test('candidate staging validates the release-only delta before exact artifact checkout', () => {
  const validator = stage.slice(
    stage.indexOf('  validate-source:\n'),
    stage.indexOf('  qualify-database-adapters:\n'),
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
  assert.match(stage, /stage-application-images:[\s\S]*needs: \[resolve, validate-source\]/)
  assert.match(dockerReusable, /ref: \$\{\{ inputs\.source_ref \|\| github\.sha \}\}/)
  assert.equal(dockerReusable.match(/persist-credentials: false/g)?.length, 3)
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
    'qualify-database-adapters',
    'qualify-database-matrix',
    'qualify-operaton-browser',
    'stage-application-images',
    'qualify-application-images',
    'stage-toolchain',
    'publish-receipt',
  ]) {
    assert.match(stage, new RegExp(`\\b${job}\\b`))
  }
  assert.match(stage, /database: \[postgres, mysql, mssql, oracle, spanner\]/)
  assert.match(stage, /run-engine-tenancy-database-matrix\.mjs --database=\$\{\{ matrix\.database \}\}/)
  assert.match(stage, /Verify five-adapter schema equivalence/)
  assert.match(stage, /\[\.\[\]\.schemaFingerprint\] \| unique \| length/)
  assert.match(stage, /DATABASE_MATRIX_RESULT/)
  assert.match(stage, /operaton\/operaton@sha256:0843bc2b4cedf1d01fdc965203f8c213c3d63a810d49c43fc141608a6f9bb813/)
  assert.match(stage, /OPERATON_BROWSER_RESULT/)
  assert.match(stage, /operaton-backstop-browser\.spec\.ts/)
  assert.match(stage, /smoke-images-local\.sh/)
  assert.match(stage, /--force-oracle/)
  assert.match(stage, /Run Mission Control browser journey on exact candidate images/)
  assert.match(stage, /test:e2e:smoke:postgres:images/)
  assert.match(stage, /release-candidate-image-browser-/)
  assert.match(stage, /--severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN/)
  assert.match(stage, /--volume "\$GITHUB_WORKSPACE\/\.trivyignore:\/workspace\/\.trivyignore:ro"/)
  assert.match(stage, /--ignorefile \/workspace\/\.trivyignore/)
  assert.match(stage, /plugin-installer:\$installer_version-\$SOURCE_REF/)
  assert.match(stage, /source scripts\/release-candidate-artifacts\.sh/)
  assert.match(artifactHelper, /release-candidates\/charts\/\$SOURCE_REF\/\$chart/)
  assert.match(artifactHelper, /helm-chart-archive\.mjs compare "\$archive" "\$pulled" >&2 \|\| return 1/)
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
  assert.match(toolchainStage, /packages\/enterprise-plugin-api pack --pack-destination "\$plugin_package_output"/)
})

test('application release publication promotes candidate digests and delays aliases', () => {
  const applicationBuild = dockerReusable.slice(
    dockerReusable.indexOf('  build:\n'),
    dockerReusable.indexOf('\n  publish:\n'),
  )
  assert.match(dockerReusable, /source_ref:/)
  assert.match(dockerReusable, /ref: \$\{\{ inputs\.source_ref \|\| github\.sha \}\}/)
  assert.match(dockerReusable, /ref: \$\{\{ needs\.prepare\.outputs\.source_revision \}\}/)
  assert.match(dockerReusable, /Verify exact image source checkout/)
  assert.match(dockerReusable, /Verify exact manifest source checkout/)
  assert.match(dockerReusable, /image_version:/)
  assert.match(dockerReusable, /platform: linux\/amd64/)
  assert.match(dockerReusable, /platform: linux\/arm64/)
  assert.equal(dockerReusable.match(/runner: ubuntu-24\.04-arm/g)?.length, 2)
  assert.equal(dockerReusable.match(/runner: ubuntu-24\.04\n/g)?.length, 2)
  assert.match(applicationBuild, /runs-on: \$\{\{ matrix\.runner \}\}/)
  assert.doesNotMatch(applicationBuild, /runs-on: ubuntu-latest/)
  assert.doesNotMatch(
    applicationBuild,
    /setup-qemu-action/,
  )
  assert.equal(dockerReusable.match(/component: backend/g)?.length, 2)
  assert.equal(dockerReusable.match(/component: frontend/g)?.length, 2)
  assert.match(dockerReusable, /org\.opencontainers\.image\.revision=\$\{\{ needs\.prepare\.outputs\.source_revision \}\}/)
  assert.match(dockerReusable, /cache-from: type=registry,ref=\$\{\{ steps\.component\.outputs\.cache_ref \}\}/)
  assert.match(dockerReusable, /cache-to: type=registry,ref=\$\{\{ steps\.component\.outputs\.cache_ref \}\},mode=max/)
  assert.match(dockerReusable, /needs: \[prepare, build\]/)
  assert.match(dockerReusable, /Assemble and expose exact multi-platform build digests/)
  assert.match(dockerReusable, /docker buildx imagetools create -t "\$image:\$IMAGE_TAG" "\$\{sources\[@\]\}"/)
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
    assert.match(section, /needs: \[resolve, publish\]/)
    assert.match(section, /if:[\s\S]{0,160}always\(\)[\s\S]{0,160}needs\.publish\.result == 'success'/)
    assert.match(section, /needs\.publish\.outputs\.candidate_qualified != 'true'/)
    assert.match(aliases, new RegExp(`needs\\.${gate}\\.result == 'success'`))
  }
  const qualifiedPromotion = jobSection('verify-qualified-promotion')
  assert.match(qualifiedPromotion, /needs: \[resolve, publish\]/)
  assert.match(qualifiedPromotion, /needs\.publish\.outputs\.candidate_qualified == 'true'/)
  assert.match(qualifiedPromotion, /Verify public release tags retain candidate digest identity/)
  assert.match(qualifiedPromotion, /oras resolve "\$BACKEND_REF"/)
  assert.match(aliases, /needs\.verify-qualified-promotion\.result == 'success'/)
  assert.match(docker, /candidate_qualified=true/)
  assert.match(docker, /candidate_qualified=false/)
  assert.match(aliases, /if: >-\n\s+always\(\) &&/)
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
  assert.match(packages, /cp "\$CANDIDATE_PAYLOAD"\/packages\/plugin\/\*\.tgz/)
  assert.match(packages, /New package publications require the signed candidate release_tag/)
})

test('candidate pipeline changes always re-run release readiness', () => {
  assert.match(detect, /node scripts\/ci-change-classifier\.mjs/)
  for (const changedPath of [
    '.github/workflows/release-candidate-stage.yml',
    'scripts/release-candidate-receipt.mjs',
    'scripts/release-candidate-artifacts.sh',
    'scripts/fetch-release-candidate.sh',
  ]) {
    const classification = classifyChangedFiles([changedPath])
    assert.equal(classification.workflow_or_release, true, changedPath)
    assert.equal(classification.run_release_readiness, true, changedPath)
  }
})

test('chart consumers enforce source-bound subjects before either copying or reusing public tags', () => {
  for (const [workflow, marker] of [[hostChart, '      - name: Publish or verify immutable chart'], [toolchain, '      - name: Package and publish the fixed Helm charts']]) {
    const step = workflow.slice(workflow.indexOf(marker))
    assert.match(step, /source scripts\/release-candidate-artifacts\.sh/)
    assert.ok(step.indexOf('candidate_chart_subject') < step.indexOf('candidate_resolve_optional'))
    assert.ok(step.indexOf('candidate_compare_chart') < step.indexOf('oras cp -r'))
  }
})

// Execute the actual sourced functions through Bash command substitutions, with
// only registry/build transports replaced. A real canonical archive comparison
// ensures the regression does not merely assert a changed workflow string.
const chartSource = 'a'.repeat(40)
const chartDigest = `sha256:${'b'.repeat(64)}`
const publicChartDigest = `sha256:${'c'.repeat(64)}`
const chartName = 'enterpriseglue-host'
const candidateChartRepository = `ghcr.io/enterpriseglue/release-candidates/charts/${chartSource}/${chartName}`

async function artifactHarness(t, { mode = 'candidate', failure = '', action = 'chart', source = chartSource } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'eg-candidate-chart-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const chart = path.join(directory, chartName)
  await mkdir(chart)
  await writeFile(path.join(chart, 'Chart.yaml'), 'name: enterpriseglue-host\nversion: 0.1.20\n')
  await writeFile(path.join(chart, 'values.yaml'), 'runtimeRole: eg_shard_runtime\n')
  const archive = path.join(directory, 'candidate.tgz')
  execFileSync('tar', ['-czf', archive, '-C', directory, chartName])
  await writeFile(path.join(chart, 'values.yaml'), failure === 'compare' ? 'oldPayload: true\n' : 'runtimeRole: eg_shard_runtime\n')
  // Semantically equivalent, byte-distinct archive metadata models a retry.
  await utimes(path.join(chart, 'values.yaml'), new Date('2020-01-01'), new Date('2020-01-01'))
  const stored = path.join(directory, 'stored.tgz')
  execFileSync('tar', ['-czf', stored, '-C', directory, chartName])
  const log = path.join(directory, 'calls')
  await writeFile(log, '')
  const shell = `
set -euo pipefail
source "$HELPER"
oras() {
  printf 'oras %s\\n' "$*" >> "$CALLS"
  case "$1" in
    resolve)
      if [[ "$FAILURE" == lookup ]]; then echo 'unauthorized: access denied' >&2; return 1; fi
      if [[ "$FAILURE" == forbidden ]]; then echo 'Error response from registry: 403 Forbidden' >&2; return 1; fi
      if [[ "$FAILURE" == network ]]; then echo 'read: connection reset by peer' >&2; return 1; fi
      if [[ "$FAILURE" == credential ]]; then echo 'credential helper file not found' >&2; return 1; fi
      if [[ "$FAILURE" == mixed ]]; then printf 'network error\\nError response from registry: failed to resolve digest: %s: not found\\n' "$2" >&2; return 1; fi
      if [[ "$FAILURE" == wrong-reference ]]; then echo 'Error response from registry: failed to resolve digest: another: not found' >&2; return 1; fi
      if [[ -f "$STATE" ]]; then
        [[ "$FAILURE" != final-resolve ]] || return 1
        if [[ "$FAILURE" == invalid-digest ]]; then printf invalid; elif [[ "$MODE" == public ]]; then printf '%s' "$PUBLIC_DIGEST"; else printf '%s' "$DIGEST"; fi
      elif [[ "$MODE" == candidate && "$2" == *release-candidates* ]]; then
        if [[ "$FAILURE" == invalid-digest ]]; then printf invalid; else printf '%s' "$DIGEST"; fi
      elif [[ "$MODE" == public && "$2" != *release-candidates* ]]; then printf '%s' "$PUBLIC_DIGEST"
      else echo "Error response from registry: failed to resolve digest: $2: not found" >&2; return 1; fi ;;
    manifest)
      [[ "$FAILURE" != manifest ]] || return 1
      if [[ "$FAILURE" == malformed-manifest ]]; then printf '{}'; else printf '{"layers":[{"mediaType":"application/vnd.cncf.helm.chart.content.v1.tar+gzip","digest":"%s"}]}' "$DIGEST"; fi ;;
    blob) [[ "$FAILURE" != blob ]] || return 1; cp "$STORED" "$4" ;;
    cp) [[ "$FAILURE" != copy ]] || return 1; touch "$STATE" ;;
    *) return 1 ;;
  esac
}
helm() { printf 'helm %s\\n' "$*" >> "$CALLS"; [[ "$FAILURE" != push ]] || return 1; touch "$STATE"; }
docker() { printf 'docker %s\\n' "$*" >> "$CALLS"; [[ "$FAILURE" != build ]] || return 1; touch "$STATE"; printf 'build diagnostic'; }
node() { shift; "$REAL_NODE" "$COMPARATOR" "$@"; }
if [[ "$ACTION" == image ]]; then
  subject="$(stage_image "ghcr.io/enterpriseglue/plugin-installer:0.2.9-$SOURCE_REF" Dockerfile 0.2.9)"
else
  subject="$(stage_chart "$ARCHIVE" enterpriseglue-host 0.1.20)"
fi
printf '%s' "$subject"
printf 'sign\\n' >> "$CALLS"
`
  const result = spawnSync('bash', ['-c', shell], {
    encoding: 'utf8',
    env: { ...process.env, HELPER: new URL('./release-candidate-artifacts.sh', import.meta.url).pathname,
      COMPARATOR: new URL('./helm-chart-archive.mjs', import.meta.url).pathname, REAL_NODE: process.execPath,
      RUNNER_TEMP: directory, SOURCE_REF: source, MODE: mode, FAILURE: failure, ACTION: action,
      DIGEST: chartDigest, PUBLIC_DIGEST: publicChartDigest, CALLS: log, STATE: path.join(directory, 'written'),
      ARCHIVE: archive, STORED: stored, GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'EnterpriseGlue/enterpriseglue-the-bridge-oss' },
  })
  return { ...result, calls: await readFile(log, 'utf8'), archive: await readFile(archive), stored: await readFile(stored) }
}

for (const mode of ['candidate', 'public', 'new']) {
  test(`actual chart staging safely handles ${mode} identity without public writes`, async (t) => {
    const result = await artifactHarness(t, { mode })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, `${candidateChartRepository}@${mode === 'public' ? publicChartDigest : chartDigest}`)
    assert.deepEqual(result.archive, result.stored, 'retained bundle chart must match exact OCI layer bytes')
    assert.match(result.calls, /sign\n$/)
    if (mode === 'candidate') assert.doesNotMatch(result.calls, /helm |oras cp/)
    if (mode === 'public') assert.match(result.calls, new RegExp(`oras cp -r ghcr.io/enterpriseglue/charts/${chartName}@${publicChartDigest} ${candidateChartRepository}:0.1.20`))
    if (mode === 'new') assert.match(result.calls, new RegExp(`helm push .* oci://ghcr.io/enterpriseglue/release-candidates/charts/${chartSource}`))
  })
}

for (const [mode, failures] of [
  ['candidate', ['compare', 'manifest', 'malformed-manifest', 'blob', 'invalid-digest', 'lookup', 'forbidden', 'network', 'credential', 'mixed', 'wrong-reference']],
  ['public', ['compare', 'copy', 'final-resolve']],
  ['new', ['push', 'final-resolve', 'invalid-digest']],
]) {
  for (const failure of failures) test(`actual chart staging rejects ${mode}/${failure} before signing`, async (t) => {
    const result = await artifactHarness(t, { mode, failure })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.calls, /sign/)
    if (['compare', 'manifest', 'malformed-manifest', 'blob', 'lookup', 'forbidden', 'network', 'credential', 'mixed', 'wrong-reference'].includes(failure)) {
      assert.doesNotMatch(result.calls, /helm |oras cp/)
    }
  })
}

test('new candidate source uses a different namespace for the same semantic chart version', async (t) => {
  const source = 'd'.repeat(40)
  const result = await artifactHarness(t, { source, mode: 'new' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `ghcr.io/enterpriseglue/release-candidates/charts/${source}/${chartName}@${chartDigest}`)
  assert.doesNotMatch(result.calls, new RegExp(chartSource))
})

for (const failure of ['build', 'final-resolve', 'invalid-digest', 'lookup', 'credential']) {
  test(`actual image command substitution rejects ${failure} before signing`, async (t) => {
    const result = await artifactHarness(t, { action: 'image', mode: 'new', failure })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.calls, /sign/)
  })
}

test('actual image command substitution emits only the immutable digest after a build', async (t) => {
  const result = await artifactHarness(t, { action: 'image', mode: 'new' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `ghcr.io/enterpriseglue/plugin-installer@${chartDigest}`)
})

test('actual consumer subject validation rejects wrong source, chart, registry and legacy namespace', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eg-candidate-subject-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const receipt = path.join(directory, 'receipt.json')
  const charts = { hostChart: 'enterpriseglue-host', runtimeChart: 'enterpriseglue-plugin-runtime', installerRbacChart: 'enterpriseglue-plugin-installer-rbac', managerChart: 'enterpriseglue-plugin-manager' }
  for (const [key, chart] of Object.entries(charts)) {
    const valid = `ghcr.io/enterpriseglue/release-candidates/charts/${chartSource}/${chart}@${chartDigest}`
    for (const subject of [valid, valid.replace(chartSource, 'd'.repeat(40)), valid.replace(chart, 'unexpected-chart'), valid.replace('ghcr.io', 'attacker.invalid'), valid.replace(`${chartSource}/`, ''), valid.replace(chartDigest, 'not-a-digest')]) {
      await writeFile(receipt, JSON.stringify({ sourceRevision: chartSource, subjects: { [key]: { subject } } }))
      const result = spawnSync('bash', ['-c', 'set -euo pipefail; source "$1"; subject="$(candidate_chart_subject "$2" "$3")"; printf "%s" "$subject"', 'test', new URL('./release-candidate-artifacts.sh', import.meta.url).pathname, receipt, key], { encoding: 'utf8' })
      assert.equal(result.status === 0, subject === valid, subject)
      assert.equal(result.stdout, subject === valid ? valid : '')
    }
  }
})

test('actual plugin promotion function propagates identity, comparison and lookup failures through substitution', async (t) => {
  const body = toolchain.match(/          publish_or_verify_chart\(\) \{([\s\S]*?)\n          \}/)
  assert.ok(body, 'protected workflow must contain the promotion function under test')
  const directory = await mkdtemp(path.join(tmpdir(), 'eg-chart-promotion-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls = path.join(directory, 'calls')
  for (const failure of ['subject', 'compare', 'lookup', 'copy']) {
    await writeFile(calls, '')
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
candidate_chart_subject() { [[ "$FAILURE" != subject ]] || return 1; printf '%s' "$SUBJECT"; }
candidate_compare_chart() { [[ "$FAILURE" != compare ]] || return 1; }
candidate_resolve_optional() { [[ "$FAILURE" != lookup ]] || return 1; }
oras() { printf '%s\\n' "$*" >> "$CALLS"; return 1; }
publish_or_verify_chart() {${body[1]}
}
result="$(publish_or_verify_chart candidate.tgz ghcr.io/enterpriseglue/charts/enterpriseglue-plugin-runtime 0.2.9 runtimeChart)"
printf 'unsafe-success'
`], { encoding: 'utf8', env: { ...process.env, FAILURE: failure, CALLS: calls, CANDIDATE_RECEIPT: 'receipt.json', SUBJECT: `${candidateChartRepository}@${chartDigest}` } })
    assert.notEqual(result.status, 0, failure)
    assert.equal(result.stdout, '', failure)
    const actualCalls = await readFile(calls, 'utf8')
    if (failure !== 'copy') assert.equal(actualCalls, '', failure)
    else assert.match(actualCalls, /^cp -r /)
  }
})

test('candidate toolchain rehearsal is mandatory, bounded, retained and before receipt publication', async () => {
  const job = stage.slice(stage.indexOf('  stage-toolchain:\n'), stage.indexOf('\n  publish-receipt:\n'))
  const rehearsal = job.indexOf('      - name: Rehearse candidate package publication and disconnected toolchain import\n')
  assert.ok(rehearsal > job.indexOf('      - name: Stage immutable toolchain artifacts\n'))
  assert.ok(rehearsal < job.indexOf('      - name: Retain exact candidate packages and charts\n'))
  const step = job.slice(rehearsal, job.indexOf('      - name: Retain candidate-bound toolchain rehearsal diagnostics\n'))
  assert.match(step, /timeout-minutes: 30/)
  assert.doesNotMatch(step, /continue-on-error:|\n\s+if:/)
  assert.match(step, /check-release-candidate-toolchain\.sh "\$SOURCE_REF" "\$TRUSTED_REF" "\$RELEASE_TAG"/)
  assert.match(job, /Retain candidate-bound toolchain rehearsal diagnostics\n\s+if: always\(\)/)
  assert.match(job, /name: release-candidate-toolchain-rehearsal-\$\{\{ needs\.resolve\.outputs\.source_ref \}\}/)
  assert.match(job, /path: \.artifacts\/release-candidate-toolchain\n\s+if-no-files-found: error\n\s+retention-days: 90/)
  const script = await read('./check-release-candidate-toolchain.sh')
  assert.doesNotMatch(script, /check-release-candidate-readiness\.sh|test:release-readiness/)
  assert.match(script, /publish-plugin-package-set\.mjs dry-run/)
  assert.match(script, /publish-host-package-set\.mjs dry-run/)
  assert.match(script, /test:plugin-toolchain-release:local/)
  const classification = classifyChangedFiles(['scripts/check-release-candidate-toolchain.sh'])
  assert.equal(classification.run_release_readiness, true)
  assert.equal(classification.unknown_high_risk, false)
  assert.equal(classification.run_ci_images, false)
  assert.equal(classification.run_database_matrix, false)
})

async function rehearsalFixture(operation) {
  const root = await mkdtemp(path.join(tmpdir(), 'eg-candidate-rehearsal-'))
  try {
    await mkdir(path.join(root, 'scripts'))
    await mkdir(path.join(root, 'bin'))
    for (const type of ['plugin', 'host']) await mkdir(path.join(root, '.artifacts/release-candidate-payload/packages', type), { recursive: true })
    for (const [type, count] of [['plugin', 5], ['host', 3]]) for (let index = 0; index < count; index++) await writeFile(path.join(root, `.artifacts/release-candidate-payload/packages/${type}/package-${index}.tgz`), `synthetic-${type}-${index}`)
    await writeFile(path.join(root, 'scripts/check-release-candidate-toolchain.sh'), await read('./check-release-candidate-toolchain.sh'))
    execFileSync('git', ['init', '--quiet', root])
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture'], { cwd: root })
    const trusted = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    for (const command of ['node', 'pnpm']) {
      await writeFile(path.join(root, 'bin', command), `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';
const step = ${JSON.stringify(command)} === 'pnpm' ? 'rehearsal' : process.argv[2].includes('plugin-package') ? 'plugin' : 'host';
if (step !== 'rehearsal' && (process.argv[3] !== 'dry-run' || !process.argv[4].endsWith('/.artifacts/release-candidate-payload/packages/'+step))) process.exit(19);
if (step === 'rehearsal' && process.argv.slice(2).join(' ') !== 'run test:plugin-toolchain-release:local') process.exit(19);
appendFileSync(process.env.TEST_CALLS, step+'\\n');
if (process.env.TEST_MUTATE === step) appendFileSync(process.argv[4]+'/package-0.tgz', 'changed');
if (process.env.TEST_FAIL === step) { process.stderr.write('synthetic diagnostic '+step); process.exit(17); }
if (process.env.TEST_HANG === step) setInterval(()=>{},1000);
else process.stdout.write(JSON.stringify({step,mode:'dry-run'})+'\\n');
`, { mode: 0o755 })
    }
    const args = ['scripts/check-release-candidate-toolchain.sh', '1'.repeat(40), trusted, 'v0.20.9']
    const env = { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, TEST_CALLS: path.join(root, 'calls'), GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2' }
    await operation({ root, args, env, trusted })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('rehearsal binds both sources and runs all three commands before writing passed', async () => {
  await rehearsalFixture(async ({ root, args, env, trusted }) => {
    execFileSync('bash', args, { cwd: root, env })
    assert.equal(await readFile(path.join(root, 'calls'), 'utf8'), 'plugin\nhost\nrehearsal\n')
    const receipt = JSON.parse(await readFile(path.join(root, '.artifacts/release-candidate-toolchain/rehearsal.json'), 'utf8'))
    assert.equal(receipt.sourceRevision, '1'.repeat(40))
    assert.equal(receipt.trustedSourceRevision, trusted)
    assert.equal(receipt.releaseTag, 'v0.20.9')
    assert.equal(receipt.runId, '42'); assert.equal(receipt.runAttempt, '2')
    assert.equal(receipt.status, 'passed'); assert.equal(receipt.publicationPerformed, false)
    assert.ok(Object.values(receipt.checks).every((value) => value === true))
    const { runId, runAttempt, ...proof } = receipt
    assert.equal(proof.artifacts.length, 8)
    for (const artifact of proof.artifacts) assert.equal(artifact.sha256, createHash('sha256').update(await readFile(path.join(root, '.artifacts/release-candidate-payload', artifact.path))).digest('hex'))
    assert.deepEqual(JSON.parse(await readFile(path.join(root, '.artifacts/release-candidate-payload/packages/toolchain-rehearsal.json'), 'utf8')), proof)
  })
})

for (const failed of ['plugin', 'host', 'rehearsal']) test(`failed ${failed} cannot issue passing evidence`, async () => {
  await rehearsalFixture(async ({ root, args, env }) => {
    assert.throws(() => execFileSync('bash', args, { cwd: root, env: { ...env, TEST_FAIL: failed } }))
    const output = path.join(root, '.artifacts/release-candidate-toolchain')
    await assert.rejects(readFile(path.join(output, 'rehearsal.json')), { code: 'ENOENT' })
    await assert.rejects(readFile(path.join(root, '.artifacts/release-candidate-payload/packages/toolchain-rehearsal.json')), { code: 'ENOENT' })
    assert.equal(JSON.parse(await readFile(path.join(output, 'execution.json'), 'utf8')).status, 'started')
    assert.equal((await readFile(path.join(root, 'calls'), 'utf8')).trim().split('\n').at(-1), failed)
    const log = failed === 'rehearsal' ? 'toolchain-local.log' : `${failed}-package-dry-run.stderr.log`
    assert.match(await readFile(path.join(output, log), 'utf8'), /synthetic diagnostic/)
  })
})

test('wrong checkout authority is rejected before any rehearsal command', async () => {
  await rehearsalFixture(async ({ root, args, env }) => {
    args[2] = '2'.repeat(40)
    assert.throws(() => execFileSync('bash', args, { cwd: root, env }))
    await assert.rejects(readFile(path.join(root, 'calls')), { code: 'ENOENT' })
  })
})

test('a changed tarball cannot be certified as the original candidate payload', async () => {
  await rehearsalFixture(async ({ root, args, env }) => {
    assert.throws(() => execFileSync('bash', args, { cwd: root, env: { ...env, TEST_MUTATE: 'plugin' } }))
    await assert.rejects(readFile(path.join(root, '.artifacts/release-candidate-payload/packages/toolchain-rehearsal.json')), { code: 'ENOENT' })
  })
})

test('new run identities do not change immutable signed proof for unchanged candidate bytes', async () => {
  await rehearsalFixture(async ({ root, args, env }) => {
    execFileSync('bash', args, { cwd: root, env })
    const proofPath = path.join(root, '.artifacts/release-candidate-payload/packages/toolchain-rehearsal.json')
    const original = await readFile(proofPath, 'utf8')
    // Only this test-owned diagnostic directory is discarded to model a new runner.
    await rm(path.join(root, '.artifacts/release-candidate-toolchain'), { recursive: true })
    execFileSync('bash', args, { cwd: root, env: { ...env, GITHUB_RUN_ID: '43', GITHUB_RUN_ATTEMPT: '3' } })
    assert.equal(await readFile(proofPath, 'utf8'), original)
    assert.equal(JSON.parse(await readFile(path.join(root, '.artifacts/release-candidate-toolchain/execution.json'), 'utf8')).runId, '43')
  })
})

test('cancelled rehearsal retains partial diagnostics without a passing receipt', async () => {
  await rehearsalFixture(async ({ root, args, env }) => {
    const child = spawn('bash', args, { cwd: root, env: { ...env, TEST_HANG: 'rehearsal' }, detached: true, stdio: 'ignore' })
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    try {
      let entered = false
      for (let attempt = 0; attempt < 500; attempt++) {
        const calls = await readFile(path.join(root, 'calls'), 'utf8').catch(() => '')
        if (calls.endsWith('rehearsal\n')) { entered = true; break }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.equal(entered, true)
    } finally { process.kill(-child.pid, 'SIGTERM'); await closed }
    await assert.rejects(readFile(path.join(root, '.artifacts/release-candidate-toolchain/rehearsal.json')), { code: 'ENOENT' })
    assert.equal(JSON.parse(await readFile(path.join(root, '.artifacts/release-candidate-toolchain/execution.json'), 'utf8')).status, 'started')
  })
})
