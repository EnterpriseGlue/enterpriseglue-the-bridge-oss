import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../.github/workflows/plugin-package-release.yml', import.meta.url),
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
assert.match(workflow, /verify-plugin-package-tarballs\.mjs/);
assert.match(workflow, /Reject immutable version reuse/);
assert.match(workflow, /Publish packages in dependency order/);
assert.match(workflow, /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/);
assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?:main|master|v?\d+(?:\.\d+){0,2})\s*$/m);

console.log(JSON.stringify({ status: 'passed', packages: 3, customerCiRequired: false }));
