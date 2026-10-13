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
  assert.match(publish, /COSIGN_EXPERIMENTAL: '1'/);
  assert.match(publish, /run-id: \$\{\{ needs.validate.outputs.qualification_run_id \|\| github.run_id \}\}/);
  assert.match(publish, /needs.qualify.result == 'skipped' && needs.validate.outputs.qualification_run_id != ''/);
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
    run: { path: '.github/workflows/oracle-image-release.yml', event: 'workflow_dispatch',
      head_branch: 'main', head_sha: source, status: 'completed', conclusion: 'failure',
      repository: { full_name: 'EnterpriseGlue/enterpriseglue-the-bridge-oss' },
      head_repository: { full_name: 'EnterpriseGlue/enterpriseglue-the-bridge-oss' } },
    jobs: ['amd64', 'arm64'].map(arch => ({ name: `qualify / Required AES256 and real Oracle SSO (${arch})`, status: 'completed', conclusion: 'success' })),
    artifacts: ['amd64', 'arm64'].map(arch => ({ name: `oracle-nne-acceptance-${arch}-123`, expired: false, size_in_bytes: 100 })),
  };
}

async function verifyRelease(fixture) {
  const outputs = {}, calls = [];
  const methods = { getBranch: 'branch', getReleaseByTag: 'release', getCommit: 'commit', compareCommitsWithBasehead: 'comparison' };
  const repos = Object.fromEntries(Object.entries(methods).map(([method, result]) => [method, async argument => {
    calls.push({ method, argument }); return { data: fixture[result] };
  }]));
  const actions = {
    getWorkflowRun: async argument => { calls.push({ method: 'getWorkflowRun', argument }); return { data: fixture.run }; },
    listJobsForWorkflowRun: 'jobs', listWorkflowRunArtifacts: 'artifacts',
  };
  await new AsyncFunction('context', 'process', 'github', 'core', validation)(
    fixture.context, { env: fixture.environment }, { rest: { repos, actions },
      paginate: async (method, argument) => { calls.push({ method, argument }); return fixture[method]; } },
    { setOutput: (key, value) => { outputs[key] = value; } },
  );
  return { outputs, calls };
}

test('Oracle publisher verifies the API-resolved stable source before passing it to qualification', async () => {
  for (const status of ['ahead', 'identical']) {
    const fixture = releaseFixture(); fixture.comparison.status = status;
    const result = await verifyRelease(fixture);
    assert.deepEqual(result.outputs, { source_ref: fixture.commit.sha, release_tag: fixture.release.tag_name, qualification_run_id: '' });
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

test('Oracle recovery reuses completed native qualification from the exact first-party released source', async () => {
  const fixture = releaseFixture(); fixture.environment.QUALIFICATION_RUN_ID = '123';
  const result = await verifyRelease(fixture);
  assert.deepEqual(result.outputs, { source_ref: fixture.commit.sha, release_tag: fixture.release.tag_name, qualification_run_id: '123' });
  assert.equal(result.calls.find(call => call.method === 'jobs').argument.filter, 'latest');
});

for (const [name, change] of [
  ['invalid run ID', f => { f.environment.QUALIFICATION_RUN_ID = 'main'; }],
  ['unsafe integer', f => { f.environment.QUALIFICATION_RUN_ID = '9007199254740992'; }],
  ['another workflow', f => { f.run.path = '.github/workflows/ci.yml'; }],
  ['automatic run', f => { f.run.event = 'push'; }],
  ['another branch', f => { f.run.head_branch = 'feature'; }],
  ['another source', f => { f.run.head_sha = 'c'.repeat(40); }],
  ['foreign head repository', f => { f.run.head_repository.full_name = 'fork/host'; }],
  ['foreign repository', f => { f.run.repository.full_name = 'fork/host'; }],
  ['unfinished run', f => { f.run.status = 'in_progress'; }],
  ['failed architecture', f => { f.jobs[0].conclusion = 'failure'; }],
  ['skipped architecture', f => { f.jobs[0].conclusion = 'skipped'; }],
  ['missing architecture', f => { f.jobs.pop(); }],
  ['duplicate qualifier', f => { f.jobs.push({ ...f.jobs[0] }); }],
  ['missing artifact', f => { f.artifacts.pop(); }],
  ['expired artifact', f => { f.artifacts[0].expired = true; }],
  ['unknown expiry', f => { delete f.artifacts[0].expired; }],
  ['empty artifact', f => { f.artifacts[0].size_in_bytes = 0; }],
  ['wrong artifact run', f => { f.artifacts[0].name = 'oracle-nne-acceptance-amd64-456'; }],
]) {
  test(`Oracle recovery rejects ${name}`, async () => {
    const fixture = releaseFixture(); fixture.environment.QUALIFICATION_RUN_ID = '123'; change(fixture);
    await assert.rejects(verifyRelease(fixture), /Oracle recovery requires/);
  });
}

test('Oracle stable-tag preflight rejects existing tags and unknown registry state before image writes', () => {
  const step = workflow.slice(workflow.indexOf('      - name: Scan and publish'), workflow.indexOf('      - uses: actions/attest'));
  const shell = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length)
    .split('\n').map(line => line.slice(10)).join('\n');
  const preflight = shell.slice(shell.indexOf('registry_error=$(mktemp)'), shell.indexOf('refs=()'));
  const fixture = `set -euo pipefail\nimage=ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend-oracle\ntrap 'rm -f "$registry_error"' EXIT\noras() { if [[ "$REGISTRY_CASE" == existing ]]; then echo sha256:fixture; return 0; fi; if [[ "$REGISTRY_CASE" == missing ]]; then echo 'Error response from registry: failed to resolve digest: ghcr.io/enterpriseglue/enterpriseglue-the-bridge-oss-backend-oracle:v0.31.0: not found' >&2; else echo 'registry authentication or transport failed' >&2; fi; return 1; }\n${preflight}`;
  for (const registryCase of ['existing', 'unknown', 'missing']) {
    const execute = () => execFileSync('bash', ['-c', fixture], { env: { ...process.env, GITHUB_REPOSITORY_OWNER: 'EnterpriseGlue', RELEASE_TAG: 'v0.31.0', REGISTRY_CASE: registryCase }, stdio: 'pipe' });
    if (registryCase === 'missing') execute(); else assert.throws(execute);
  }
});

if (process.env.ORACLE_COSIGN_MODE_CANARY === 'true') {
  test('pinned Cosign accepts the publisher OCI mode only with its declared experimental environment', () => {
    const version = execFileSync('cosign', ['version', '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(version).gitVersion, 'v3.1.3');
    const env = { ...process.env, COSIGN_EXPERIMENTAL: '' };
    const args = ['sign', '--registry-referrers-mode=oci-1-1', '--help'];
    assert.throws(() => execFileSync('cosign', args, { env, stdio: 'pipe' }), /COSIGN_EXPERIMENTAL/);
    execFileSync('cosign', args, { env: { ...env, COSIGN_EXPERIMENTAL: '1' }, stdio: 'pipe' });
  });
}
