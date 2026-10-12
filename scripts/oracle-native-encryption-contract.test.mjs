import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEncryptionEvidence } from './verify-oracle-session-encryption.mjs';
import { oracleClientComponent, addOracleClientComponent } from './complete-oracle-image-sbom.mjs';

for (const protocol of ['oidc', 'saml', 'ldap']) {
  test(`${protocol} browser preflight recognizes Linux ARM64 and CFT executables but rejects non-executable files`, () => {
    const source = readFileSync(`scripts/run-local-${protocol}-rehearsal-test.sh`, 'utf8');
    const line = source.split('\n').find(value => value.startsWith('if [[ -z "$headless_shell_path"'));
    assert.ok(line);
    const check = line.slice(line.indexOf('find '), line.indexOf('; then'));
    const directory = mkdtempSync(path.join(tmpdir(), 'eg-headless-preflight-'));
    const execute = () => execFileSync('bash', ['-c', `headless_shell_path="$HEADLESS_SHELL_TEST_DIR"; ${check}`], {
      env: { ...process.env, HEADLESS_SHELL_TEST_DIR: directory }, stdio: 'pipe',
    });
    try {
      assert.throws(execute);
      for (const name of ['headless_shell', 'chrome-headless-shell', 'chrome-headless-shell.exe']) {
        const file = path.join(directory, name);
        writeFileSync(file, 'fixture'); chmodSync(file, 0o600);
        assert.throws(execute);
        chmodSync(file, 0o755); execute(); rmSync(file);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('Oracle SBOM includes the correct architecture distribution and licence without losing scanner inventory', () => {
  const installer = readFileSync('backend/install-oracle-instant-client.sh', 'utf8');
  const notices = readFileSync('backend/oracle-runtime-notices.txt', 'utf8');
  for (const architecture of ['amd64', 'arm64']) {
    const component = oracleClientComponent(architecture, notices, installer);
    assert.equal(component.version, '23.26.3');
    assert.match(component.externalReferences[0].url, /\/2326300\/instantclient-basic-linux\./);
    assert.match(component.externalReferences[0].hashes[0].content, /^[a-f0-9]{64}$/);
    const sbom = { components: [{ 'bom-ref': 'oracledb' }], metadata: { component: { 'bom-ref': 'image' } } };
    addOracleClientComponent(sbom, component); addOracleClientComponent(sbom, component);
    assert.equal(sbom.components.length, 2);
    assert.deepEqual(sbom.dependencies[0].dependsOn, [component['bom-ref']]);
  }
  assert.throws(() => oracleClientComponent('ppc64le', notices, installer), /architecture/);
  assert.throws(() => oracleClientComponent('arm64', notices.replace('23.26.3', '23.26.4'), installer), /versions differ/);
});

test('Oracle evidence cannot pass with no application sessions or an unencrypted session', () => {
  assert.deepEqual(parseEncryptionEvidence('EG_NNE_COUNTS|3|0'), { status: 'passed', algorithm: 'AES256', sessions: 3, unencrypted: 0 });
  assert.throws(() => parseEncryptionEvidence('EG_NNE_COUNTS|0|0'), /No application sessions/);
  assert.throws(() => parseEncryptionEvidence('EG_NNE_COUNTS|3|1'), /without negotiated AES256/);
  assert.throws(() => parseEncryptionEvidence('Encryption service adapter'), /did not return/);
});

test('default and Oracle production image flavors share the compiled application', () => {
  const source = readFileSync('backend/Dockerfile.prod', 'utf8');
  assert.match(source, /FROM application AS oracle/);
  assert.match(source, /FROM application AS standard\s*$/);
  assert.match(source, /COPY --from=oracle-client-download \/opt\/oracle \/opt\/oracle/);
});


test('Oracle publication requires a released SHA and retained security-qualified bytes', () => {
  const publish = readFileSync('.github/workflows/oracle-image-release.yml', 'utf8');
  assert.match(publish, /workflow_dispatch:/);
  assert.doesNotMatch(publish.slice(publish.indexOf('  validate:'), publish.indexOf('  qualify:')), /actions\/checkout@/);
  assert.match(publish, /ref: \$\{\{ needs.validate.outputs.source_ref \}\}/);
  assert.doesNotMatch(publish, /ref: \$\{\{ inputs.source_ref \}\}/);
  assert.match(publish, /gzip -dc "\$directory\/qualified-backend-image.tar.gz" \| docker load/);
  assert.ok(publish.indexOf('scripts/scan-oracle-image.sh') < publish.indexOf('docker push'));
  assert.match(publish, /--type cyclonedx/);
  assert.match(publish, /actions\/attest-build-provenance@/);
  const harness = readFileSync('scripts/run-ci-identity-protocol-rehearsals.sh', 'utf8');
  assert.ok(harness.indexOf('scripts/scan-oracle-image.sh') < harness.indexOf('run_compose up --no-build'));
  const scan = readFileSync('scripts/scan-oracle-image.sh', 'utf8');
  assert.match(scan, /--severity "CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN"/);
  assert.doesNotMatch(scan, /--ignore-unfixed/);
  assert.match(scan, /--format cyclonedx "\$image" > "\$output_dir\/sbom.cdx.json"/);
  assert.doesNotMatch(scan, /"\$output_dir:\/evidence"|--output \/evidence/);
});

const workflow = readFileSync('.github/workflows/oracle-image-release.yml', 'utf8');
const validation = workflow.slice(workflow.indexOf('          script: |\n') + '          script: |\n'.length, workflow.indexOf('\n  qualify:'))
  .split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function releaseFixture() {
  const source = 'a'.repeat(40), current = 'b'.repeat(40);
  return {
    context: { eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha: current,
      repo: { owner: 'EnterpriseGlue', repo: 'enterpriseglue-the-bridge-oss' } },
    environment: { SOURCE_REF: source, RELEASE_TAG: 'v0.31.0' },
    branch: { protected: true, commit: { sha: current } },
    release: { draft: false, prerelease: false, tag_name: 'v0.31.0' },
    commit: { sha: source }, comparison: { status: 'ahead' },
  };
}

async function verifyRelease(fixture) {
  const outputs = {}, calls = [];
  const methods = { getBranch: 'branch', getReleaseByTag: 'release', getCommit: 'commit', compareCommitsWithBasehead: 'comparison' };
  const repos = Object.fromEntries(Object.entries(methods).map(([method, result]) => [method, async argument => {
    calls.push({ method, argument }); return { data: fixture[result] };
  }]));
  await new AsyncFunction('context', 'process', 'github', 'core', validation)(
    fixture.context, { env: fixture.environment }, { rest: { repos } },
    { setOutput: (key, value) => { outputs[key] = value; } },
  );
  return { outputs, calls };
}

test('Oracle publisher verifies the API-resolved stable source before passing it to qualification', async () => {
  for (const status of ['ahead', 'identical']) {
    const fixture = releaseFixture(); fixture.comparison.status = status;
    const result = await verifyRelease(fixture);
    assert.deepEqual(result.outputs, { source_ref: fixture.commit.sha, release_tag: fixture.release.tag_name });
    assert.deepEqual(result.calls.map(call => call.method), ['getBranch', 'getReleaseByTag', 'getCommit', 'compareCommitsWithBasehead']);
    assert.equal(result.calls[2].argument.ref, 'v0.31.0');
  }
});

for (const [name, change] of [
  ['automatic event', fixture => { fixture.context.eventName = 'push'; }],
  ['branch dispatch', fixture => { fixture.context.ref = 'refs/heads/feature'; }],
  ['foreign owner', fixture => { fixture.context.repo.owner = 'fork'; }],
  ['foreign repository', fixture => { fixture.context.repo.repo = 'other'; }],
  ['mutable source', fixture => { fixture.environment.SOURCE_REF = 'main'; }],
  ['unstable tag', fixture => { fixture.environment.RELEASE_TAG = 'v0.31.0-rc.1'; }],
  ['unprotected main', fixture => { fixture.branch.protected = false; }],
  ['stale workflow', fixture => { fixture.branch.commit.sha = 'c'.repeat(40); }],
  ['draft release', fixture => { fixture.release.draft = true; }],
  ['prerelease', fixture => { fixture.release.prerelease = true; }],
  ['wrong release tag', fixture => { fixture.release.tag_name = 'v0.30.1'; }],
  ['different released source', fixture => { fixture.commit.sha = 'c'.repeat(40); }],
  ['divergent history', fixture => { fixture.comparison.status = 'diverged'; }],
  ['source ahead of main', fixture => { fixture.comparison.status = 'behind'; }],
]) {
  test(`Oracle publisher rejects ${name} without emitting qualification authority`, async () => {
    const fixture = releaseFixture(); change(fixture);
    await assert.rejects(verifyRelease(fixture), /Oracle publication|released|protected main/);
  });
}
