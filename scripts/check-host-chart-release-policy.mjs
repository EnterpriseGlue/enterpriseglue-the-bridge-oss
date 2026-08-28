import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../.github/workflows/host-chart-release.yml', import.meta.url),
  'utf8',
);

assert.match(workflow, /workflows: \[Docker Images\]/);
assert.match(workflow, /github\.event\.workflow_run\.event == 'release'/);
assert.match(workflow, /source_ref must equal the protected workflow commit/);
assert.match(workflow, /\[\[ "\$\(git rev-list -n 1 "\$release_tag"\)" == "\$SOURCE_REF" \]\]/);
assert.match(workflow, /Host chart appVersion \$app_version must equal OSS release \$release_tag/);
assert.match(workflow, /bash scripts\/check-enterpriseglue-host-chart\.sh/);
assert.equal([...workflow.matchAll(/helm package "\$chart"/g)].length, 2);
assert.match(workflow, /helm-chart-archive\.mjs compare/);
assert.match(workflow, /helm push "\$CHART_ARCHIVE" oci:\/\/ghcr\.io\/enterpriseglue\/charts/);
assert.match(workflow, /Published immutable chart version differs from source/);
assert.match(workflow, /CHART_REFERENCE=\$CHART_REPOSITORY@\$digest/);
assert.match(workflow, /cosign sign --yes --registry-referrers-mode=oci-1-1 "\$CHART_REFERENCE"/);
assert.match(workflow, /cosign verify/);
assert.match(workflow, /certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
assert.match(workflow, /oras blob fetch/);
assert.match(workflow, /enterpriseglue-host-chart-release\/v1/);
assert.match(workflow, /gh release upload "\$RELEASE_TAG"/);
assert.match(workflow, /if-no-files-found: error/);
assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?:main|master|v?\d+(?:\.\d+){0,2})\s*$/m);
assert.doesNotMatch(workflow, /kubectl\s+(?:apply|create|patch|replace)/);

console.log('OSS host chart protected release policy passed');

