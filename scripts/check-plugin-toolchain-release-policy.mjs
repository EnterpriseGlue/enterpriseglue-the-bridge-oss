import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL(
    '../.github/workflows/plugin-toolchain-release.yml',
    import.meta.url,
  ),
  'utf8',
);
const productionImageGate = await readFile(
  new URL('./check-plugin-platform-production-images.sh', import.meta.url),
  'utf8',
);
const installerDockerfile = await readFile(
  new URL('../packages/plugin-installer/Dockerfile', import.meta.url),
  'utf8',
);
const managerDockerfile = await readFile(
  new URL('../packages/plugin-manager/Dockerfile', import.meta.url),
  'utf8',
);

assert.match(workflow, /\bon:\n  workflow_run:/);
assert.match(workflow, /workflows: \[Docker Images\]/);
assert.match(workflow, /types: \[completed\]/);
assert.match(workflow, /\n  workflow_dispatch:/);
assert.doesNotMatch(
  workflow,
  /^  (?:push|pull_request|pull_request_target|release|schedule):/m,
);
for (const dockerfile of [installerDockerfile, managerDockerfile]) {
  assert.match(dockerfile, /golang:1\.26\.6-alpine3\.23@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /oras\.land\/oras\/cmd\/oras@v1\.3\.3/);
  assert.match(dockerfile, /go build -buildvcs=false -trimpath -o \/out\/oras/);
  assert.doesNotMatch(dockerfile, /go install oras\.land\/oras\/cmd\/oras/);
  assert.match(dockerfile, /github\.com\/sigstore\/cosign\/v3\/cmd\/cosign@v3\.1\.3/);
  assert.match(dockerfile, /golang\.org\/x\/mod@v0\.40\.0/);
  assert.match(dockerfile, /golang\.org\/x\/text@v0\.39\.0/);
  assert.match(dockerfile, /google\.golang\.org\/grpc@v1\.82\.1/);
  assert.equal(
    [...dockerfile.matchAll(/id=enterpriseglue-plugin-toolchain-go-modules/g)].length,
    2,
    'Both Go tool stages must retain downloaded modules across transient retries',
  );
  assert.equal(
    [...dockerfile.matchAll(/id=enterpriseglue-plugin-toolchain-go-build/g)].length,
    2,
    'Both Go tool stages must retain compiler output across transient retries',
  );
  assert.equal(
    [...dockerfile.matchAll(/while ! "\$@"/g)].length,
    2,
    'Both Go tool stages must retry transient module-resolution failures',
  );
  assert.match(dockerfile, /test -z "\$\(find \/output -type f -name '\*\.node'/);
}
assert.match(productionImageGate, /packages\/plugin-installer\/Dockerfile/);
assert.match(productionImageGate, /packages\/plugin-manager\/Dockerfile/);
assert.match(productionImageGate, /docker buildx create/);
assert.match(productionImageGate, /--driver docker-container/);
assert.match(productionImageGate, /docker buildx inspect "\$MULTIARCH_BUILDER_NAME" --bootstrap/);
assert.match(productionImageGate, /--builder "\$MULTIARCH_BUILDER_NAME"/);
assert.match(productionImageGate, /docker buildx rm --force/);
assert.match(productionImageGate, /CREATED_MULTIARCH_BUILDER/);
assert.match(productionImageGate, /for platform in linux\/amd64 linux\/arm64/);
assert.match(productionImageGate, /--platform "\$platform"/);
assert.match(productionImageGate, /--target oras/);
assert.match(productionImageGate, /--output=type=cacheonly/);
assert.equal(
  [...productionImageGate.matchAll(/--load --quiet/g)].length,
  4,
  'All production images must reuse the prepared Buildx builder before loading',
);
assert.equal(
  [...productionImageGate.matchAll(/--severity HIGH,CRITICAL/g)].length,
  1,
  'The looped PR vulnerability gate must scan both public toolchain images',
);
assert.match(workflow, /environment: plugin-toolchain-production/);
assert.match(workflow, /timeout-minutes: 90/);
assert.match(
  workflow,
  /source_ref must be an immutable 40-character commit/,
);
assert.match(
  workflow,
  /source_ref must equal the protected workflow commit/,
);
assert.match(workflow, /\[\[ "\$\(git rev-parse HEAD\)" == "\$SOURCE_REF" \]\]/);
assert.match(workflow, /test -z "\$\(git status --porcelain\)"/);
assert.match(workflow, /packages: write/);
assert.match(workflow, /contents: write/);
assert.match(workflow, /id-token: write/);
assert.match(workflow, /attestations: write/);
assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
assert.match(workflow, /file: \.\/packages\/plugin-installer\/Dockerfile/);
assert.match(workflow, /file: \.\/packages\/plugin-manager\/Dockerfile/);
assert.match(workflow, /provenance: mode=max/);
assert.match(workflow, /sbom: true/);
assert.match(workflow, /cosign-release: v3\.1\.3/);
assert.match(workflow, /pnpm test:plugin-platform/);
assert.match(workflow, /pnpm typecheck:plugin-platform/);
assert.match(workflow, /pnpm test:plugin-platform:helm/);
assert.match(workflow, /helm package infra\/kubernetes\/helm\/enterpriseglue-plugin-runtime/);
assert.match(
  workflow,
  /helm package infra\/kubernetes\/helm\/enterpriseglue-plugin-installer-rbac/,
);
assert.match(
  workflow,
  /helm package infra\/kubernetes\/helm\/enterpriseglue-plugin-manager/,
);
assert.match(
  workflow,
  /publish_or_verify_chart "\$RUNTIME_ARCHIVE" "\$RUNTIME_CHART_REPOSITORY"/,
);
assert.match(
  workflow,
  /publish_or_verify_chart "\$RBAC_ARCHIVE" "\$RBAC_CHART_REPOSITORY"/,
);
assert.match(
  workflow,
  /publish_or_verify_chart "\$MANAGER_ARCHIVE" "\$MANAGER_CHART_REPOSITORY"/,
);
assert.match(workflow, /Resolve resumable immutable image state/);
assert.match(workflow, /installer_exists=\$installer_exists/);
assert.match(workflow, /manager_exists=\$manager_exists/);
assert.match(workflow, /steps\.existing-images\.outputs\.installer_exists != 'true'/);
assert.match(workflow, /steps\.existing-images\.outputs\.manager_exists != 'true'/);
assert.match(workflow, /publish_or_verify_chart/);
assert.match(workflow, /Published immutable chart version/);
assert.match(
  workflow,
  /node scripts\/helm-chart-archive\.mjs compare "\$archive" "\$pulled"/,
);
for (const archive of [
  'RUNTIME_ARCHIVE',
  'RBAC_ARCHIVE',
  'MANAGER_ARCHIVE',
]) {
  const reproducibilityComparison = [
    'node scripts/helm-chart-archive.mjs compare \\',
    `            "$${archive}" "$REPRO_OUTPUT/$(basename "$${archive}")"`,
  ].join('\n');
  assert.ok(
    workflow.includes(reproducibilityComparison),
    `The release workflow must compare ${archive} canonically`,
  );
}
assert.doesNotMatch(
  workflow,
  /sha256sum "\$(?:RUNTIME|RBAC|MANAGER)_ARCHIVE"[\s\S]{0,160}REPRO_OUTPUT/,
);
for (const [candidate, published] of [
  ['RUNTIME_CHART_ARCHIVE', 'PULLED_RUNTIME'],
  ['RBAC_CHART_ARCHIVE', 'PULLED_RBAC'],
  ['MANAGER_CHART_ARCHIVE', 'PULLED_MANAGER_CHART'],
]) {
  assert.match(
    workflow,
    new RegExp(
      `node scripts/helm-chart-archive\\.mjs compare "\\$${candidate}" "\\$${published}"`,
    ),
  );
}
assert.doesNotMatch(
  workflow,
  /sha256sum "\$archive"[\s\S]{0,120}sha256sum "\$pulled"/,
);
assert.doesNotMatch(
  workflow,
  /sha256sum "\$(?:RUNTIME|RBAC|MANAGER)_CHART_ARCHIVE"[\s\S]{0,120}sha256sum "\$PULLED_/,
);
assert.match(
  workflow,
  /PUBLISHED_RUNTIME_CHART_ARCHIVE=\$PULLED_RUNTIME/,
);
assert.match(workflow, /cp "\$PUBLISHED_RUNTIME_CHART_ARCHIVE" "\$RECEIPT\/"/);
assert.match(workflow, /sha256sum "\$PUBLISHED_RUNTIME_CHART_ARCHIVE"/);
assert.match(workflow, /sha256sum "\$PUBLISHED_RBAC_CHART_ARCHIVE"/);
assert.match(workflow, /sha256sum "\$PUBLISHED_MANAGER_CHART_ARCHIVE"/);
assert.match(workflow, /event\.workflow_run\.event == 'release'/);
assert.match(workflow, /git tag --points-at "\$SOURCE_REF"/);
assert.match(workflow, /SOURCE_DATE_EPOCH=/);
assert.match(workflow, /RUNTIME_CHART_REFERENCE=.*@\$RUNTIME_DIGEST/);
assert.match(workflow, /RBAC_CHART_REFERENCE=.*@\$RBAC_DIGEST/);
assert.match(workflow, /MANAGER_REFERENCE=.*@\$MANAGER_DIGEST/);
assert.match(workflow, /MANAGER_CHART_REFERENCE=.*@\$MANAGER_CHART_DIGEST/);
assert.equal(
  [...workflow.matchAll(/cosign sign --yes/g)].length,
  1,
  'The single looped signing command must cover all five exact subjects',
);
assert.match(workflow, /"\$INSTALLER_REFERENCE"/);
assert.match(workflow, /"\$MANAGER_REFERENCE"/);
assert.match(workflow, /"\$RUNTIME_CHART_REFERENCE"/);
assert.match(workflow, /"\$RBAC_CHART_REFERENCE"/);
assert.match(workflow, /"\$MANAGER_CHART_REFERENCE"/);
assert.match(workflow, /cosign verify/);
assert.match(workflow, /oras manifest fetch "\$RUNTIME_CHART_REFERENCE"/);
assert.match(workflow, /oras manifest fetch "\$RBAC_CHART_REFERENCE"/);
assert.match(workflow, /oras manifest fetch "\$MANAGER_CHART_REFERENCE"/);
assert.match(
  workflow,
  /application\/vnd\.cncf\.helm\.chart\.content\.v1\.tar\+gzip/,
);
assert.match(workflow, /oras blob fetch/);
assert.match(workflow, /aquasec\/trivy@sha256:[a-f0-9]{64}/);
assert.match(
  workflow,
  /uses: actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/,
);
assert.match(workflow, /schemaVersion: "enterpriseglue-plugin-toolchain-release\/v1"/);
assert.match(workflow, /customerCiRequired: false/);
assert.match(workflow, /customerBuildRequired: false/);
assert.match(
  workflow,
  /node scripts\/plugin-toolchain-airgap\.mjs export/,
);
assert.match(
  workflow,
  /cosign sign-blob --yes[\s\S]*toolchain-airgap\.sigstore\.json/,
);
assert.match(
  workflow,
  /cosign trusted-root create[\s\S]*--with-default-services/,
);
assert.match(
  workflow,
  /node scripts\/plugin-toolchain-airgap\.mjs import/,
);
assert.match(
  workflow,
  /schemaVersion == "enterpriseglue-plugin-toolchain-airgap-import\/v1"/,
);
assert.match(workflow, /sourceRegistryAccessed == false/);
assert.match(
  workflow,
  /ZOT_IMAGE: ghcr\.io\/project-zot\/zot-minimal@sha256:[a-f0-9]{64}/,
);
assert.match(workflow, /if-no-files-found: error/);
assert.match(workflow, /Resolve and verify the published OSS application images/);
assert.match(workflow, /gh run download "\$docker_images_run"/);
assert.match(workflow, /image-digests-\$RELEASE_TAG/);
assert.match(workflow, /oras resolve "\$backend_tag"/);
assert.match(workflow, /oras resolve "\$frontend_tag"/);
assert.match(workflow, /certificate-identity-regexp "\$image_identity"/);
assert.match(workflow, /Build and publish the signed OSS distribution assets/);
assert.match(workflow, /build-plugin-compose-deployment-kit\.mjs/);
assert.match(workflow, /enterpriseglue-distribution-lock\.mjs create/);
assert.match(workflow, /enterpriseglue-distribution-lock\.mjs verify/);
assert.match(workflow, /enterpriseglue-distribution-lock-\$RELEASE_TAG\.sigstore\.json/);
assert.match(workflow, /gh release upload "\$RELEASE_TAG"/);
assert.match(workflow, /enterpriseglue-frontend-static-\$RELEASE_TAG\.tar\.gz/);
assert.match(workflow, /enterpriseglue-plugin-deployment-kit-\$RELEASE_TAG\.tar\.gz/);
assert.doesNotMatch(
  workflow,
  /^\s*uses:\s+[^\s@]+@(?:main|master|v?\d+(?:\.\d+){0,2})\s*$/m,
);
assert.doesNotMatch(
  workflow,
  /(?:customer.*(?:docker build|pnpm|npm)|kubectl\s+(?:apply|create|patch|replace))/i,
);

const publishIndex = workflow.indexOf(
  'Build and publish the multi-architecture installer',
);
const chartIndex = workflow.indexOf(
  'Package and publish the fixed Helm charts',
);
const signIndex = workflow.indexOf(
  'Sign all immutable toolchain subjects with workload identity',
);
const verifyIndex = workflow.indexOf(
  'Verify signatures, scans, tools, and exact chart payloads',
);
const receiptIndex = workflow.indexOf(
  'Write the immutable toolchain release receipt',
);
const airgapIndex = workflow.indexOf(
  'Build, sign, and verify the generic air-gap toolchain',
);
const applicationIndex = workflow.indexOf(
  'Resolve and verify the published OSS application images',
);
const distributionIndex = workflow.indexOf(
  'Build and publish the signed OSS distribution assets',
);
const retainIndex = workflow.indexOf(
  'Retain the non-secret toolchain receipt',
);
assert.ok(publishIndex >= 0 && publishIndex < signIndex);
assert.ok(chartIndex >= 0 && chartIndex < signIndex);
assert.ok(signIndex < verifyIndex);
assert.ok(verifyIndex < receiptIndex);
assert.ok(receiptIndex < airgapIndex);
assert.ok(airgapIndex < applicationIndex);
assert.ok(applicationIndex < distributionIndex);
assert.ok(distributionIndex < retainIndex);

console.log(
  JSON.stringify({
    status: 'passed',
    workflow: 'plugin-toolchain-release.yml',
    customerCiRequired: false,
    immutableSubjects: 5,
    signedAirgapBundle: true,
  }),
);
