import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/engine-compatibility.yml', import.meta.url), 'utf8');
const journey = await readFile(new URL('../test/e2e/operaton-backstop-browser.spec.ts', import.meta.url), 'utf8');

test('engine compatibility runs weekly and on demand outside pull-request CI', () => {
  assert.match(workflow, /schedule:\n\s+- cron:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  (?:pull_request|merge_group|push|release):/m);
  assert.match(workflow, /fail-fast: false/);
  assert.doesNotMatch(workflow, /continue-on-error: true[\s\S]*Run process overview/);
});

test('engine compatibility preserves a pinned release gate and tests upstream latest', () => {
  assert.match(workflow, /profile: supported-2\.1/);
  assert.match(workflow, /operaton\/operaton@sha256:0843bc2b4cedf1d01fdc965203f8c213c3d63a810d49c43fc141608a6f9bb813/);
  assert.match(workflow, /profile: upstream-latest-advisory/);
  assert.match(workflow, /operaton\/operaton:latest/);
  assert.match(workflow, /OPERATON_EXPECTED_VERSION_PATTERN/);
  assert.match(journey, /process\.env\.OPERATON_EXPECTED_VERSION_PATTERN/);
});

test('both profiles run the complete strict browser journey and retain diagnostics', () => {
  assert.match(workflow, /operaton-backstop-browser\.spec\.ts/);
  assert.match(workflow, /process overview, detail, BPMN, variables, state, health, and diagnostics/);
  assert.match(workflow, /test\/results\/playwright/);
  assert.match(workflow, /docker logs --tail 300/);
  assert.match(journey, /process\.env\.EG_BACKEND_ENV_FILE \|\| resolve\(repoRoot, '\.env\.docker'\)/);
});
