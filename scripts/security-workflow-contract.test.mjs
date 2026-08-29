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
const dockerImages = readFileSync(
  new URL('../.github/workflows/docker-images.yml', import.meta.url),
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

test('image publishing labels and verifies source, revision, and version', () => {
  for (const label of [
    'org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}',
    'org.opencontainers.image.revision=${{ steps.meta.outputs.source_revision }}',
    'org.opencontainers.image.version=${{ steps.meta.outputs.image_version }}',
  ]) {
    assert.equal(imagePublish.split(label).length - 1, 4, `${label} must cover both image attempts`);
  }

  assert.match(imagePublish, /- name: Verify published image provenance/);
  assert.match(imagePublish, /EXPECTED_SOURCE: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}/);
  assert.match(imagePublish, /EXPECTED_REVISION: \$\{\{ steps\.meta\.outputs\.source_revision \}\}/);
  assert.match(imagePublish, /EXPECTED_VERSION: \$\{\{ steps\.meta\.outputs\.image_version \}\}/);
  assert.match(imagePublish, /verify-oci-image-metadata\.mjs "\$prefix"/);
});

test('multi-architecture image publishing allows healthy emulated builds to finish', () => {
  assert.match(imagePublish, /publish:\n    runs-on: ubuntu-latest\n    timeout-minutes: 150/);
  assert.equal(
    imagePublish.match(/timeout-minutes: 60/g)?.length,
    4,
    'both attempts for both images must have the extended build window',
  );
  assert.doesNotMatch(imagePublish, /timeout-minutes: (?:30|90)/);
});

test('published Postgres image smoke compiles test dependencies and preserves fail-closed engine policy', () => {
  const install = dockerImages.indexOf('- name: Install dependencies');
  const buildShared = dockerImages.indexOf('- name: Build shared test dependencies');
  const smoke = dockerImages.indexOf('- name: Run Mission Control Playwright smoke on Postgres images');
  assert.ok(install >= 0 && install < buildShared, 'shared test dependencies must build after install');
  assert.ok(buildShared < smoke, 'shared test dependencies must build before Playwright starts');
  assert.match(dockerImages, /run: pnpm run build:shared/);
  assert.match(dockerImages, /echo "EG_ENGINE_ALLOWED_HOSTS=camunda-mock"/);
  assert.match(dockerImages, /echo "EG_ENGINE_ALLOW_PRIVATE_HOSTS=true"/);
  assert.match(dockerImages, /echo "EG_ALLOW_INSECURE_ENGINE_HTTP=true"/);
  assert.match(dockerImages, /echo "EG_ENFORCE_ENGINE_ENDPOINT_POLICY=true"/);
});

test('published Postgres image smoke passes the configured encryption boundary into Playwright', () => {
  assert.match(postgresImageSmoke, /encryption_key="\$\(env_first ENCRYPTION_KEY\)"/);
  assert.match(postgresImageSmoke, /\[\[ -n "\$encryption_key" \]\] \|\| error "ENCRYPTION_KEY missing in \$ENV_FILE"/);
  assert.match(postgresImageSmoke, /-e ENCRYPTION_KEY \\/);
  assert.match(postgresImageSmoke, /ENCRYPTION_KEY="\$encryption_key" \\/);
});
