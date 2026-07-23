import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const writer = readFileSync(new URL('./write-engine-tenancy-manifest-evidence.mjs', import.meta.url), 'utf8');
const localWriter = readFileSync(new URL('./write-engine-tenancy-local-evidence.mjs', import.meta.url), 'utf8');
const releaseIndexWriter = readFileSync(new URL('./write-engine-tenancy-release-index.mjs', import.meta.url), 'utf8');
const sourceCoverageRunner = readFileSync(new URL('./run-engine-tenancy-source-coverage.mjs', import.meta.url), 'utf8');
const localRunner = readFileSync(new URL('./run-engine-tenancy-local-evidence.sh', import.meta.url), 'utf8');
const browserWriter = readFileSync(new URL('./write-authz-browser-evidence.mjs', import.meta.url), 'utf8');
const mutationWriter = readFileSync(new URL('./run-authz-mutation-tests.mjs', import.meta.url), 'utf8');
const playwrightConfig = readFileSync(new URL('../test/e2e/playwright.config.ts', import.meta.url), 'utf8');

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

test('keeps transient Playwright output separate from retained release evidence', () => {
  assert.match(playwrightConfig, /outputDir: '\.\.\/results\/playwright'/);
  assert.match(browserWriter, /test\/results\/playwright\/\.last-run\.json/);
  assert.ok(
    localRunner.indexOf('write-engine-tenancy-local-evidence.mjs')
      > localRunner.indexOf('test:engine-tenancy:enforcement'),
  );
  assert.match(localWriter, /engine-tenancy-release/);
  assert.match(localWriter, /local-enforcement\.json/);
  assert.match(localWriter, /appliedEngineIds\.length !== 1/);
  assert.match(localWriter, /releaseCommitQualified/);
  assert.doesNotMatch(localWriter, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('builds a fail-closed same-commit release evidence index', () => {
  assert.match(packageJson.scripts['test:engine-tenancy:evidence-index'], /write-engine-tenancy-release-index\.mjs/);
  assert.match(packageJson.scripts['test:engine-tenancy:release-evidence'], /--require-complete/);
  for (const gate of [
    'traceability',
    'localEnforcement',
    'mutation',
    'browserMatrix',
    'authorizationMatrix',
    'databaseMatrix',
    'provisioningJourneys',
    'sourceCoverage',
    'documentationReview',
  ]) {
    assert.match(releaseIndexWriter, new RegExp(`id: '${gate}'`));
  }
  assert.match(releaseIndexWriter, /sameCommit/);
  assert.match(releaseIndexWriter, /releaseCommitQualified === true/);
  assert.match(releaseIndexWriter, /passedGateCount === gateDefinitions\.length/);
  for (const matrixContract of [
    'constraint-derived-authorization-state-space',
    'canonicalInputHash',
    'classifiedCanonicalValueCount',
    'executedApplicableCellCount',
    'executedInvalidityWitnessCount',
    'unknownCells',
    'unexpectedCells',
  ]) {
    assert.match(releaseIndexWriter, new RegExp(matrixContract));
  }
  assert.match(releaseIndexWriter, /README\.md/);
  assert.match(releaseIndexWriter, /process\.exitCode = 1/);
});

test('qualifies mutation evidence only for an exact clean commit', () => {
  assert.match(mutationWriter, /evidenceKind: 'engine-tenancy-targeted-mutation'/);
  assert.match(mutationWriter, /commit/);
  assert.match(mutationWriter, /sourceState/);
  assert.match(mutationWriter, /releaseCommitQualified/);
  assert.match(mutationWriter, /containsCredentials: false/);
  assert.match(mutationWriter, /containsTokens: false/);
});

test('retains literal 100 percent source coverage for every security-critical module lane', () => {
  assert.match(packageJson.scripts['test:engine-tenancy:source-coverage'], /run-engine-tenancy-source-coverage\.mjs/);
  for (const script of [
    'test:engine-tenancy:provisioning',
    'test:engine-tenancy:mappings',
    'test:engine-tenancy:authorization',
    'test:engine-tenancy:runtime',
    'test:engine-tenancy:transitions',
    'test:engine-tenancy:operations',
    'test:authz:machine-principal-coverage',
    'test:authz:policy-coverage',
    'test:authz:api-client-middleware-coverage',
  ]) {
    assert.match(sourceCoverageRunner, new RegExp(`script: '${script}'`));
  }
  assert.match(sourceCoverageRunner, /lines: 100/);
  assert.match(sourceCoverageRunner, /statements: 100/);
  assert.match(sourceCoverageRunner, /branches: 100/);
  assert.match(sourceCoverageRunner, /functions: 100/);
  assert.match(sourceCoverageRunner, /Source-coverage evidence must be run from a clean worktree/);
  assert.match(sourceCoverageRunner, /Source changed while coverage evidence was running/);
  assert.match(sourceCoverageRunner, /scripts\/local-safe-test\.env/);
  assert.match(sourceCoverageRunner, /delete safeEnvironment\[key\]/);
  assert.match(sourceCoverageRunner, /source-coverage\.json/);
  assert.doesNotMatch(sourceCoverageRunner, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});
