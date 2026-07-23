import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const writer = readFileSync(new URL('./write-engine-tenancy-manifest-evidence.mjs', import.meta.url), 'utf8');

test('writes sanitized commit, schema, target, waiver, and requirement traceability evidence', () => {
  const manifestCommand = packageJson.scripts['test:engine-tenancy:manifest'];
  assert.match(manifestCommand, /engine-tenancy-functional-coverage\.test\.mjs/);
  assert.match(manifestCommand, /engine-tenancy-evidence\.test\.mjs/);
  assert.match(manifestCommand, /write-engine-tenancy-manifest-evidence\.mjs/);

  for (const requiredField of [
    'commit',
    'worktreeClean',
    'nodeVersion',
    'pnpmVersion',
    'databaseSchemaVersion',
    'coverageScope',
    'uncoveredRequirementCount',
    'publicOperationCount',
    'stableErrorCount',
    'supportedTransitionCount',
    'waiverCount',
    'declaredTargets',
    'verifiedTargets',
    'requirements',
  ]) {
    assert.match(writer, new RegExp(`\\b${requiredField}\\b`));
  }
  assert.match(writer, /test\/results\/engine-tenancy-release/);
  assert.match(writer, /traceability-only/);
  assert.match(writer, /not inferred from this manifest/);
  assert.doesNotMatch(writer, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});
