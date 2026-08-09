import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.match(nightly, /docker\/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f/);
  assert.match(nightly, /docker buildx imagetools inspect "\$backend_ref" --format '\{\{json \.\}\}'/);
  assert.match(nightly, /verify-oci-image-metadata\.mjs backend/);
  assert.match(nightly, /verify-oci-image-metadata\.mjs frontend/);
  assert.match(nightly, /steps\.image-meta\.outputs\.backend_revision/);
  assert.match(nightly, /steps\.image-meta\.outputs\.frontend_revision/);
});

test('image publishing labels and verifies source, revision, and version', () => {
  for (const label of [
    'org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}',
    'org.opencontainers.image.revision=${{ github.sha }}',
    'org.opencontainers.image.version=${{ steps.meta.outputs.image_tag }}',
  ]) {
    assert.equal(imagePublish.split(label).length - 1, 4, `${label} must cover both image attempts`);
  }

  assert.match(imagePublish, /- name: Verify published image provenance/);
  assert.match(imagePublish, /EXPECTED_SOURCE: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}/);
  assert.match(imagePublish, /EXPECTED_REVISION: \$\{\{ github\.sha \}\}/);
  assert.match(imagePublish, /EXPECTED_VERSION: \$\{\{ steps\.meta\.outputs\.image_tag \}\}/);
  assert.match(imagePublish, /verify-oci-image-metadata\.mjs "\$prefix"/);
});
