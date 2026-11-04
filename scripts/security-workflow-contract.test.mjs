import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

function installer(workflow) {
  const match = /- name: Setup Trivy\n        shell: bash\n        run: \|\n((?:          .*\n)+)/.exec(workflow);
  assert.ok(match, 'checksum-pinned Trivy installer is required');
  return match[1].split('\n').slice(0, -1).map(line => line.slice(10)).join('\n') + '\n';
}

const trivyInstaller = installer(dockerImages);
test('every Trivy CLI lane uses the same authenticated release pins without the unavailable redirect service', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.match(scripts['test:ci-contracts'], /scripts\/security-workflow-contract\.test\.mjs/);
  for (const name of ['ci.yml', 'ci-core-reusable.yml', 'docker-images.yml', 'security-nightly-reusable.yml']) {
    const workflow = readFileSync(new URL('../.github/workflows/' + name, import.meta.url), 'utf8');
    assert.equal(installer(workflow), trivyInstaller, name);
    assert.doesNotMatch(workflow, /uses: aquasecurity\/setup-trivy@/);
  }
  const downloadLine = trivyInstaller.split('\n').find(line => line.trim().startsWith('"https://'));
  assert.equal(downloadLine?.trim(), '"https://github.com/aquasecurity/trivy/releases/download/v0.70.0/trivy_0.70.0_${asset}.tar.gz"');
  assert.equal(trivyInstaller.includes('get.trivy.dev'), false);
  assert.doesNotMatch(trivyInstaller, /\$\{\{|curl[^\n]*\|\s*(?:ba)?sh/);
  assert.match(trivyInstaller, /8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9/);
  assert.match(trivyInstaller, /2f6bb988b553a1bbac6bdd1ce890f5e412439564e17522b88a4541b4f364fc8d/);
  assert.ok(trivyInstaller.indexOf('sha256sum -c') < trivyInstaller.indexOf('tar -xzf'));
  assert.ok(trivyInstaller.indexOf('Version: 0.70.0') < trivyInstaller.indexOf('GITHUB_PATH'));
  assert.match(trivyInstaller, /--proto '=https' --proto-redir '=https' --tlsv1\.2/);
  assert.match(trivyInstaller, /--connect-timeout 10 --max-time 120/);
});

for (const scenario of ['unsupported', 'download-failure', 'checksum-mismatch', 'existing-directory', 'existing-symlink']) {
  test(`Trivy installation fails closed for ${scenario} without publishing an executable path`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eg-trivy-installer-'));
    try {
      const bin = path.join(root, 'bin'); mkdirSync(bin);
      const runner = path.join(root, 'runner'); mkdirSync(runner);
      const destination = path.join(runner, 'enterpriseglue-trivy-0.70.0');
      if (scenario === 'existing-directory') mkdirSync(destination);
      if (scenario === 'existing-symlink') {
        const result = spawnSync('ln', ['-s', path.join(root, 'absent'), destination]); assert.equal(result.status, 0);
      }
      const executable = (name, value) => writeFileSync(path.join(bin, name), value, { mode: 0o755 });
      executable('uname', `#!/bin/sh\nif [ "$1" = '-s' ]; then echo '${scenario === 'unsupported' ? 'Darwin' : 'Linux'}'; else echo x86_64; fi\n`);
      executable('curl', '#!/bin/sh\nprintf called > "$RUNNER_TEMP/download-called"\nif [ "$INSTALL_TEST_SCENARIO" = download-failure ]; then exit 22; fi\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then shift; printf corrupt > "$1"; exit 0; fi; shift; done\nexit 1\n');
      const githubPath = path.join(root, 'github-path');
      const result = spawnSync('bash', ['-c', trivyInstaller], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
        RUNNER_TEMP: runner, GITHUB_PATH: githubPath, INSTALL_TEST_SCENARIO: scenario }, encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
      assert.equal(existsSync(githubPath), false); assert.equal(existsSync(path.join(destination, 'trivy')), false);
      assert.equal(existsSync(path.join(runner, 'download-called')), ['download-failure', 'checksum-mismatch'].includes(scenario));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

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
