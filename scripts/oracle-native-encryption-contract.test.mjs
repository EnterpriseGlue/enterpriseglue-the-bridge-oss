import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEncryptionEvidence } from './verify-oracle-session-encryption.mjs';
import { oracleClientComponent, addOracleClientComponent } from './complete-oracle-image-sbom.mjs';

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
  assert.match(publish, /\[\[ "\$SOURCE_REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(publish, /isDraft == false and \.isPrerelease == false/);
  assert.match(publish, /gzip -dc "\$directory\/qualified-backend-image.tar.gz" \| docker load/);
  assert.ok(publish.indexOf('scripts/scan-oracle-image.sh') < publish.indexOf('docker push'));
  assert.match(publish, /--type cyclonedx/);
  assert.match(publish, /actions\/attest-build-provenance@/);
  const harness = readFileSync('scripts/run-ci-identity-protocol-rehearsals.sh', 'utf8');
  assert.ok(harness.indexOf('scripts/scan-oracle-image.sh') < harness.indexOf('run_compose up --no-build'));
  const scan = readFileSync('scripts/scan-oracle-image.sh', 'utf8');
  assert.match(scan, /--severity "CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN"/);
  assert.doesNotMatch(scan, /--ignore-unfixed/);
});
