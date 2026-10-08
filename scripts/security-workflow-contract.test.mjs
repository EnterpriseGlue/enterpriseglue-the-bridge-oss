import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function stepBlock(workflow, name) {
  const start = workflow.indexOf('      - name: ' + name + '\n');
  assert.ok(start >= 0, 'missing step ' + name);
  const tail = workflow.slice(start);
  const next = tail.slice(1).search(/\n(?:      - name:|  [a-z][a-z0-9-]*:)/);
  return next < 0 ? tail : tail.slice(0, next + 1);
}

function literalRun(block) {
  const match = block.match(/^        run: \|\n((?:          .*\n|\n)+)/m);
  assert.ok(match, 'missing literal shell run');
  return match[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
}

const nightly = readFileSync(
  new URL('../.github/workflows/security-nightly-reusable.yml', import.meta.url),
  'utf8',
);
const nightlyCaller = readFileSync(
  new URL('../.github/workflows/security-nightly.yml', import.meta.url),
  'utf8',
);
const imagePublish = readFileSync(
  new URL('../.github/workflows/docker-images-reusable.yml', import.meta.url),
  'utf8',
);
const dockerImages = readFileSync(
  new URL('../.github/workflows/docker-images.yml', import.meta.url),
  'utf8',
);
const releaseCandidate = readFileSync(
  new URL('../.github/workflows/release-candidate-stage.yml', import.meta.url),
  'utf8',
);
const postgresImageSmoke = readFileSync(
  new URL('./e2e-smoke-postgres-images.sh', import.meta.url),
  'utf8',
);

test('nightly preserves evidence before enforcing the high and critical gate', () => {
  assert.match(nightly, /echo "critical=\$\{critical_total\}"/);
  assert.match(nightly, /echo "high=\$\{high_total\}"/);
  assert.match(nightly, /\} >> "\$GITHUB_OUTPUT"/);
  assert.match(nightly, /if: always\(\) && steps\.evaluate\.outcome == 'success'/);
  assert.match(nightly, /run: node scripts\/enforce-security-severity-gate\.mjs/);

  const artifact = nightly.indexOf('- name: Upload scan artifacts');
  const issue = nightly.indexOf('- name: Create or update security issue');
  const closeIssue = nightly.indexOf('- name: Close resolved security issue');
  const gate = nightly.indexOf('- name: Enforce high and critical vulnerability gate');
  assert.ok(artifact >= 0 && artifact < gate, 'scan artifacts must upload before the gate');
  assert.ok(issue >= 0 && issue < gate, 'tracking issue must update before the gate');
  assert.ok(closeIssue >= 0 && closeIssue < gate, 'resolved issue handling must precede the gate');
});

test('nightly reads and reports OCI provenance from every configured platform', () => {
  assert.match(nightlyCaller, /image_platforms: \$\{\{ needs\.resolve\.outputs\.image_platforms \}\}/);
  assert.match(nightly, /docker\/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e/);
  assert.match(nightly, /docker buildx imagetools inspect "\$backend_ref" --format '\{\{json \.\}\}'/);
  assert.match(nightly, /verify-oci-image-metadata\.mjs backend/);
  assert.match(nightly, /verify-oci-image-metadata\.mjs frontend/);
  assert.match(nightly, /steps\.image-meta\.outputs\.backend_revision/);
  assert.match(nightly, /steps\.image-meta\.outputs\.frontend_revision/);
});

test('candidate scans fail fast before functional image qualification without removing acceptance', () => {
  for (const [scan, functional] of [
    ['Scan exact bootstrap image digest', 'Qualify pristine bootstrap and fail-closed drift on real PostgreSQL'],
    ['Scan exact candidate image digests', 'Run PostgreSQL, exposed-backend, authentication, and Oracle image smokes'],
    ['Scan exact candidate image digests', 'Run Mission Control browser journey on exact candidate images'],
  ]) {
    assert.ok(releaseCandidate.indexOf('- name: ' + scan) < releaseCandidate.indexOf('- name: ' + functional));
  }
  for (const name of ['Scan exact bootstrap image digest', 'Scan exact candidate image digests']) {
    const scan = stepBlock(releaseCandidate, name);
    assert.match(scan, /--exit-code 1/);
    assert.match(scan, /CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN/);
    assert.match(scan, /--ignorefile \/workspace\/\.trivyignore/);
    assert.doesNotMatch(scan, /ignore-unfixed|\|\| true|continue-on-error/);
  }
});

test('nightly binds bootstrap to the published application composition and scans immutable subjects', () => {
  const bootstrap = stepBlock(nightly, 'Resolve matching published bootstrap provenance');
  assert.match(bootstrap, /EXPECTED_VERSION: \$\{\{ steps\.image-meta\.outputs\.backend_version/);
  assert.match(bootstrap, /EXPECTED_REVISION: \$\{\{ steps\.image-meta\.outputs\.backend_revision/);
  assert.match(bootstrap, /\[\[ "\$FRONTEND_VERSION" == "\$EXPECTED_VERSION" \]\]/);
  assert.match(bootstrap, /\[\[ "\$FRONTEND_REVISION" == "\$EXPECTED_REVISION" \]\]/);
  assert.match(bootstrap, /verify-oci-image-metadata\.mjs managedShardBootstrap/);
  for (const name of ['Trivy scan backend image', 'Trivy scan frontend image', 'Trivy scan managed-shard bootstrap image']) {
    const scan = stepBlock(nightly, name);
    assert.match(scan, /@\$\{\{ steps\.(?:image-meta|bootstrap-meta)\.outputs\./);
    assert.match(scan, /steps\.bootstrap-meta\.outcome == 'success'/);
    assert.match(scan, /TRIVY_PLATFORM: linux\/amd64/);
  }
  const close = stepBlock(nightly, 'Close resolved security issue');
  assert.match(close, /steps\.evaluate\.outcome == 'success'/);
  assert.match(close, /steps\.expiry\.outcome == 'success'/);
});

test('actual bootstrap resolver rejects release and provenance mismatches before scan subjects are emitted', () => {
  const script = literalRun(stepBlock(nightly, 'Resolve matching published bootstrap provenance'));
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'eg-bootstrap-provenance-')));
  mkdirSync(join(directory, 'scripts'));
  mkdirSync(join(directory, 'bin'));
  writeFileSync(join(directory, 'scripts/verify-oci-image-metadata.mjs'), readFileSync(new URL('./verify-oci-image-metadata.mjs', import.meta.url)));
  const docker = join(directory, 'bin/docker');
  writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$TEST_IMAGE_METADATA"\n', {mode: 0o755});
  const source = 'https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss';
  const revision = 'a'.repeat(40);
  const labels = {
    'org.opencontainers.image.source': source,
    'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.version': 'v0.29.1',
  };
  const inspection = (overrides = {}) => JSON.stringify({
    manifest: {digest: 'sha256:' + 'b'.repeat(64)},
    image: Object.fromEntries(['linux/amd64', 'linux/arm64'].map(platform => [platform, {
      config: {Labels: {...labels, ...overrides}},
    }])),
  });
  const run = (env = {}) => {
    writeFileSync(join(directory, 'outputs'), '');
    const result = spawnSync('bash', ['-c', script], {cwd: directory, encoding: 'utf8', env: {
      ...process.env, PATH: join(directory, 'bin') + ':' + process.env.PATH,
      BOOTSTRAP_IMAGE: 'ghcr.io/enterpriseglue/enterpriseglue-managed-shard-bootstrap',
      EXPECTED_PLATFORMS: 'linux/amd64,linux/arm64',
      EXPECTED_SOURCE: source, EXPECTED_VERSION: 'v0.29.1', EXPECTED_REVISION: revision,
      FRONTEND_VERSION: 'v0.29.1', FRONTEND_REVISION: revision,
      GITHUB_OUTPUT: join(directory, 'outputs'), GITHUB_STEP_SUMMARY: join(directory, 'summary'),
      TEST_IMAGE_METADATA: inspection(), ...env,
    }});
    return {...result, output: readFileSync(join(directory, 'outputs'), 'utf8')};
  };
  try {
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.output, /^managedShardBootstrap_digest=sha256:[b]{64}$/m);
    for (const invalid of [
      {FRONTEND_VERSION: 'v0.29.0'},
      {FRONTEND_REVISION: 'c'.repeat(40)},
      {EXPECTED_VERSION: 'latest'},
      {BOOTSTRAP_IMAGE: 'ghcr.io/other/unsafe'},
      {TEST_IMAGE_METADATA: inspection({'org.opencontainers.image.revision': 'c'.repeat(40)})},
      {TEST_IMAGE_METADATA: inspection({'org.opencontainers.image.source': 'https://example.invalid/other'})},
      {TEST_IMAGE_METADATA: inspection({'org.opencontainers.image.version': 'v0.29.0'})},
    ]) {
      const result = run(invalid);
      assert.notEqual(result.status, 0, JSON.stringify(Object.keys(invalid)));
      assert.equal(result.output, '', 'invalid composition must not emit scan subjects');
    }
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('nightly evaluation rejects missing or malformed reports rather than reporting a clean composition', () => {
  const script = literalRun(stepBlock(nightly, 'Evaluate findings'));
  const directory = mkdtempSync(join(tmpdir(), 'eg-security-reports-'));
  const output = join(directory, 'outputs');
  const run = () => spawnSync('bash', ['-c', script], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
  });
  try {
    for (const name of ['backend', 'frontend']) writeFileSync(join(directory, name + '-trivy.json'), '{"Results":[]}');
    assert.notEqual(run().status, 0, 'missing bootstrap cannot be clean');
    writeFileSync(join(directory, 'bootstrap-trivy.json'), '{"error":"scanner failed"}');
    assert.notEqual(run().status, 0, 'error JSON cannot be clean');
    writeFileSync(join(directory, 'bootstrap-trivy.json'), '{"Results":[]}');
    const clean = run();
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(readFileSync(output, 'utf8'), /^total=0$/m);
    writeFileSync(join(directory, 'bootstrap-trivy.json'), JSON.stringify({Results: [{
      Vulnerabilities: [{Severity: 'CRITICAL', VulnerabilityID: 'TEST-1', PkgName: 'fixture', InstalledVersion: '1', FixedVersion: '2'}],
    }]}));
    const blocked = run();
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.match(readFileSync(output, 'utf8'), /^critical=1$/m);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('image publishing labels and verifies source, revision, and version', () => {
  for (const label of [
    'org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}',
    'org.opencontainers.image.revision=${{ needs.prepare.outputs.source_revision }}',
    'org.opencontainers.image.version=${{ needs.prepare.outputs.image_version }}',
  ]) {
    assert.equal(imagePublish.split(label).length - 1, 2, `${label} must cover both matrix build attempts`);
  }

  assert.match(imagePublish, /- name: Verify published image provenance and platform coverage/);
  assert.match(imagePublish, /EXPECTED_SOURCE: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}/);
  assert.match(imagePublish, /EXPECTED_REVISION: \$\{\{ needs\.prepare\.outputs\.source_revision \}\}/);
  assert.match(imagePublish, /EXPECTED_VERSION: \$\{\{ needs\.prepare\.outputs\.image_version \}\}/);
  assert.match(imagePublish, /verify-oci-image-metadata\.mjs "\$prefix"/);
});

test('multi-architecture image publishing allows both native platform builds to finish', () => {
  assert.match(imagePublish, /build:\n    name: Build \$\{\{ matrix\.component \}\} \$\{\{ matrix\.platform \}\} application image/);
  assert.match(imagePublish, /platform: linux\/amd64/);
  assert.match(imagePublish, /platform: linux\/arm64/);
  assert.match(imagePublish, /publish:\n    name: Promote and verify application image manifests\n    needs: \[prepare, build\]/);
  assert.equal(
    imagePublish.match(/timeout-minutes: 60/g)?.length,
    2,
    'both native matrix build attempts must have the extended build window',
  );
  const buildJob = imagePublish.slice(
    imagePublish.indexOf('  build:\n'),
    imagePublish.indexOf('\n  publish:\n'),
  );
  assert.match(
    buildJob,
    /timeout-minutes: 130/,
    'the matrix job must leave enough time for setup and both 60-minute build attempts',
  );
  assert.doesNotMatch(buildJob, /timeout-minutes: (?:30|90)/);
});

test('candidate Postgres image smoke compiles test dependencies before the browser journey', () => {
  const install = releaseCandidate.indexOf('- name: Install candidate browser qualification dependencies');
  const buildShared = releaseCandidate.indexOf('- name: Build candidate browser qualification dependencies');
  const smoke = releaseCandidate.indexOf('- name: Run Mission Control browser journey on exact candidate images');
  assert.ok(install >= 0 && install < buildShared, 'shared test dependencies must build after install');
  assert.ok(buildShared < smoke, 'shared test dependencies must build before Playwright starts');
  assert.match(releaseCandidate, /run: pnpm run build:shared/);
  assert.match(releaseCandidate, /test:e2e:smoke:postgres:images/);
  assert.match(releaseCandidate, /release-candidate-image-browser-/);
  assert.match(postgresImageSmoke, /CAMUNDA_BASE_URL="http:\/\/camunda-mock:9080\/engine-rest"/);
});

test('candidate Postgres image smoke passes the configured encryption boundary into Playwright', () => {
  assert.match(postgresImageSmoke, /encryption_key="\$\(env_first ENCRYPTION_KEY\)"/);
  assert.match(postgresImageSmoke, /\[\[ -n "\$encryption_key" \]\] \|\| error "ENCRYPTION_KEY missing in \$ENV_FILE"/);
  assert.match(postgresImageSmoke, /-e ENCRYPTION_KEY \\/);
  assert.match(postgresImageSmoke, /ENCRYPTION_KEY="\$encryption_key" \\/);
});
