import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci-detect-reusable.yml', import.meta.url), 'utf8');

test('published package source directories select their owning CI lanes', () => {
  assert.match(workflow, /packages\/\(backend-host\|shared\|enterprise-plugin-api\)\//);
  assert.match(workflow, /packages\/\(frontend-host\|shared\|enterprise-plugin-api\)\//);
});

test('canonical TypeORM persistence and configuration paths select database qualification', () => {
  assert.match(workflow, /packages\/shared\/src\/\(db\|config\|infrastructure\/persistence\)\//);
});

test('package changes continue to select plugin compatibility and package checks', () => {
  assert.match(workflow, /if \[ "\$backend_changed" = true \] \|\| \[ "\$frontend_changed" = true \]; then/);
  assert.match(workflow, /run_plugin_checks=true/);
  assert.match(workflow, /run_plugin_package=true/);
});

test('draft pull requests use the normal change-aware gates', () => {
  assert.doesNotMatch(workflow, /changed_files_count=draft/);
  assert.doesNotMatch(workflow, /PR_DRAFT/);
});
