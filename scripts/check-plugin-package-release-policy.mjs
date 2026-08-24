import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../.github/workflows/plugin-package-release.yml', import.meta.url),
  'utf8',
);
const tarballVerifier = await readFile(
  new URL('./verify-plugin-package-tarballs.mjs', import.meta.url),
  'utf8',
);

assert.match(workflow, /\bon:\n  workflow_dispatch:/);
assert.doesNotMatch(workflow, /^  (?:push|pull_request|pull_request_target|release|schedule):/m);
assert.match(workflow, /environment: plugin-packages-production/);
assert.match(workflow, /source_ref must be an immutable 40-character commit/);
assert.match(workflow, /source_ref must equal the protected workflow commit/);
assert.match(workflow, /test -z "\$\(git status --porcelain\)"/);
assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
assert.match(workflow, /plugin-sdk run test/);
assert.match(workflow, /plugin-runtime run test/);
assert.match(workflow, /plugin-installer run test/);
assert.match(workflow, /plugin-manager run test/);
assert.match(workflow, /verify-plugin-package-tarballs\.mjs/);
assert.match(workflow, /Verify existing versions or plan new immutable publications/);
assert.match(workflow, /Publish packages in dependency order/);
assert.match(workflow, /publish-plugin-package-set\.mjs plan/);
assert.match(workflow, /publish-plugin-package-set\.mjs publish/);
assert.match(workflow, /publish-plugin-package-set\.mjs verify/);
assert.match(workflow, /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/);
assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?:main|master|v?\d+(?:\.\d+){0,2})\s*$/m);
assert.match(tarballVerifier, /packages\/plugin-sdk\/package\.json/);
assert.match(tarballVerifier, /packages\/plugin-runtime\/package\.json/);
assert.match(tarballVerifier, /packages\/plugin-installer\/package\.json/);
assert.match(tarballVerifier, /packages\/plugin-manager\/package\.json/);
assert.doesNotMatch(
  tarballVerifier,
  /\['@enterpriseglue\/plugin-(?:sdk|runtime|installer|manager)',\s*'\d+\.\d+\.\d+'/,
);

const packageSetPublisher = await readFile(
  new URL('./publish-plugin-package-set.mjs', import.meta.url),
  'utf8',
);
assert.match(packageSetPublisher, /dist\.integrity/);
assert.match(packageSetPublisher, /canonicalPackageDigest/);
assert.match(packageSetPublisher, /npm[\s\S]*pack/);
assert.match(packageSetPublisher, /different immutable payload/);
assert.match(packageSetPublisher, /registry payload differs after publication/);

console.log(JSON.stringify({ status: 'passed', packages: 4, customerCiRequired: false }));
