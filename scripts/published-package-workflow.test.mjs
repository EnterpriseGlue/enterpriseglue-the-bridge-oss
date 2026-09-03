import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/host-package-release.yml', import.meta.url),
  'utf8',
);
const candidateStage = await readFile(
  new URL('../.github/workflows/release-candidate-stage.yml', import.meta.url),
  'utf8',
);
const receipt = await readFile(new URL('./release-candidate-receipt.mjs', import.meta.url), 'utf8');

test('host packages publish only from an existing release or explicit protected dry run', () => {
  assert.match(workflow, /\bon:\n  release:\n/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.match(workflow, /environment: host-packages-production/);
  assert.match(workflow, /refs\/tags\/\$release_tag/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /git merge-base --is-ancestor "\$SOURCE_REF" refs\/remotes\/origin\/main/);
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /git rev-list -n 1/);
  assert.match(workflow, /fetch-release-candidate\.sh/);
  assert.match(workflow, /packages\/host\/\*\.tgz/);
  assert.match(workflow, /packages\/plugin\/\*\.tgz/);
  assert.doesNotMatch(workflow, /pnpm (?:install|pack)|Build package/);
});

test('host publication verifies and publishes the exact candidate tarballs', () => {
  assert.match(workflow, /verify-host-package-tarballs\.mjs/);
  assert.match(workflow, /publish-host-package-set\.mjs plan/);
  assert.match(workflow, /publish-host-package-set\.mjs publish/);
  assert.match(workflow, /publish-host-package-set\.mjs verify/);
  assert.match(workflow, /publish-plugin-package-set\.mjs verify/);
  assert.match(workflow, /blocked until every signed plugin\/API dependency is visible/);
  assert.match(workflow, /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a/);
  assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?:main|master|v?\d+(?:\.\d+){0,2})\s*$/m);
});

test('the signed candidate inventory contains every host package exactly once', () => {
  for (const packageName of ['shared', 'backend-host', 'frontend-host']) {
    assert.match(candidateStage, new RegExp(`pnpm --dir packages/${packageName} pack --pack-destination "\\$host_package_output"`));
    assert.match(receipt, new RegExp(`packages\\\\/host\\\\/enterpriseglue-${packageName}-`));
  }
  assert.match(candidateStage, /verify-host-package-tarballs\.mjs/);
  assert.match(candidateStage, /publish-host-package-set\.mjs plan/);
});
