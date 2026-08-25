import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'test/authz/engine-tenancy-functional-coverage.json');
const openApiPath = path.join(root, 'packages/shared/src/schemas/openapi.ts');
const engineSchemaPath = path.join(root, 'packages/shared/src/schemas/mission-control/engine.ts');
const transitionPolicyPath = path.join(root, 'packages/shared/src/engine-tenancy/transition-policy.ts');
const mutationRunnerPath = path.join(root, 'scripts/run-authz-mutation-tests.mjs');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requirements = manifest.requirements;

const knownRequirementFamilies = new Set([
  'TEN-MODEL',
  'TEN-RESOLVE',
  'TEN-DEDICATED',
  'TEN-SHARED',
  'TEN-AUTHZ',
  'TEN-API',
  'TEN-CONFIG',
  'TEN-UI',
  'TEN-MIGRATION',
  'TEN-RUNTIME',
  'TEN-AUDIT',
  'TEN-DOCS',
  'TEN-OPS',
]);

const coverageVocabulary = {
  topologies: new Set(['dedicated', 'shared', 'not-applicable']),
  runtimeAccessModes: new Set(['engine_wide', 'resource_aware', 'not-applicable']),
  principals: new Set(['user', 'group-derived-user', 'api-client', 'service-account', 'not-applicable']),
  tenantRelationships: new Set([
    'same-tenant',
    'sibling-tenant',
    'cross-tenant',
    'missing-context',
    'conflicting-context',
    'deleted-tenant',
    'request-context',
    'default-tenant',
    'explicit-reference',
    'not-applicable',
  ]),
  resourceTypes: new Set([
    'tenant',
    'project',
    'engine',
    'engine-set',
    'runtime-resource',
    'runtime-resource-set',
    'deployment-target',
    'deployment-receipt',
    'migration',
    'job',
    'task',
    'incident',
    'history',
    'not-applicable',
  ]),
  provisioningChannels: new Set([
    'manual-api',
    'external-api',
    'configuration-bundle',
    'ui',
    'not-applicable',
  ]),
  outcomes: new Set(['allow', 'deny', 'quarantine', 'conflict', 'audit', 'compatibility', 'observe']),
};

function assertUniqueStrings(values, label) {
  assert.ok(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  assert.equal(new Set(values).size, values.length, `${label} must not contain duplicates`);
  for (const value of values) {
    assert.equal(typeof value, 'string', `${label} values must be strings`);
    assert.ok(value.trim(), `${label} values must not be empty`);
  }
}

function assertRequirementReferences(items, ids, label) {
  assert.ok(Array.isArray(items) && items.length > 0, `${label} must be a non-empty array`);
  for (const item of items) {
    assertUniqueStrings(item.requirementIds, `${label}.${item.code || item.kind || `${item.method} ${item.path}`}.requirementIds`);
    for (const id of item.requirementIds) {
      assert.ok(ids.has(id), `${label} references an unknown requirement: ${id}`);
    }
  }
}

function assertCiJobExists(ciJob) {
  if (packageJson.scripts?.[ciJob]) return;
  const [workflowName, jobName] = ciJob.split(':');
  assert.ok(workflowName && jobName, `unknown CI job or package script: ${ciJob}`);
  const workflowPath = path.join(root, '.github/workflows', workflowName);
  assert.ok(fs.existsSync(workflowPath), `CI workflow does not exist: ${workflowName}`);
  assert.match(
    fs.readFileSync(workflowPath, 'utf8'),
    new RegExp(`^  ${jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'm'),
    `CI workflow job does not exist: ${ciJob}`,
  );
}

function expandedPackageScript(scriptName, visited = new Set()) {
  if (visited.has(scriptName)) return '';
  visited.add(scriptName);
  const command = packageJson.scripts?.[scriptName] || '';
  let expanded = command;
  for (const match of command.matchAll(/\bpnpm run ([\w:-]+)/g)) {
    expanded += ` ${expandedPackageScript(match[1], visited)}`;
  }
  return expanded;
}

function assertCiJobRunsTest(entry) {
  const testFileName = path.basename(entry.testFile);
  if (packageJson.scripts?.[entry.ciJob]) {
    assert.ok(
      expandedPackageScript(entry.ciJob).includes(testFileName),
      `${entry.id} CI script ${entry.ciJob} does not execute ${entry.testFile}`,
    );
    return;
  }
  const [workflowName] = entry.ciJob.split(':');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows', workflowName), 'utf8');
  assert.ok(
    workflow.includes(testFileName),
    `${entry.id} CI workflow ${entry.ciJob} does not execute ${entry.testFile}`,
  );
}

test('validates every version-2 engine tenancy functional coverage entry', () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.coverageStandard, '100-percent-functional-requirement-coverage');
  assert.ok(Array.isArray(requirements) && requirements.length > 0, 'coverage manifest must contain requirements');
  assert.deepEqual(manifest.supportedDatabases, ['postgres', 'mysql', 'mssql', 'oracle', 'spanner']);
  assert.deepEqual(manifest.supportedBrowsers, ['chromium', 'firefox', 'webkit']);
  assert.deepEqual(manifest.waivers, [], 'release coverage must not silently carry waivers');

  const ids = new Set();
  for (const entry of requirements) {
    assert.match(entry.id, /^TEN-[A-Z]+-\d{3}$/, `invalid requirement id: ${entry.id}`);
    assert.ok(!ids.has(entry.id), `duplicate requirement id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(
      knownRequirementFamilies.has(entry.id.replace(/-\d{3}$/, '')),
      `unknown requirement family: ${entry.id}`,
    );

    for (const field of [
      'requirement',
      'source',
      'expected',
      'testFile',
      'testName',
      'documentation',
      'documentationExample',
      'ciJob',
      'evidenceArtifact',
    ]) {
      assert.equal(typeof entry[field], 'string', `${entry.id}.${field} must be a string`);
      assert.ok(entry[field].trim(), `${entry.id}.${field} must not be empty`);
    }
    assertUniqueStrings(entry.dimensions, `${entry.id}.dimensions`);
    assert.equal(typeof entry.coverage, 'object', `${entry.id}.coverage must be an object`);
    assert.deepEqual(
      Object.keys(entry.coverage).sort(),
      Object.keys(coverageVocabulary).sort(),
      `${entry.id}.coverage must declare every required dimension`,
    );
    for (const [dimension, vocabulary] of Object.entries(coverageVocabulary)) {
      const values = entry.coverage[dimension];
      assertUniqueStrings(values, `${entry.id}.coverage.${dimension}`);
      for (const value of values) {
        assert.ok(vocabulary.has(value), `${entry.id}.coverage.${dimension} contains unknown value: ${value}`);
      }
      assert.ok(
        values.length === 1 || !values.includes('not-applicable'),
        `${entry.id}.coverage.${dimension} cannot combine not-applicable with covered values`,
      );
    }

    const testPath = path.join(root, entry.testFile);
    assert.ok(fs.existsSync(testPath), `${entry.id} test file does not exist: ${entry.testFile}`);
    const testSource = fs.readFileSync(testPath, 'utf8');
    assert.ok(
      testSource.includes(entry.testName),
      `${entry.id} test name is missing from ${entry.testFile}: ${entry.testName}`,
    );

    const documentationPath = path.join(root, entry.documentation);
    assert.ok(fs.existsSync(documentationPath), `${entry.id} documentation does not exist: ${entry.documentation}`);
    const documentation = fs.readFileSync(documentationPath, 'utf8');
    assert.ok(documentation.includes(entry.id), `${entry.id} is not traceable from ${entry.documentation}`);
    assert.ok(
      documentation.includes(entry.documentationExample),
      `${entry.id} documentation example/section is missing: ${entry.documentationExample}`,
    );

    assertCiJobExists(entry.ciJob);
    assertCiJobRunsTest(entry);
    assert.match(
      entry.evidenceArtifact,
      new RegExp(`^test/results/.+#${entry.id}$`),
      `${entry.id}.evidenceArtifact must be a retained test/results location anchored to the requirement`,
    );
  }

  const represented = Object.fromEntries(
    Object.keys(coverageVocabulary).map((dimension) => [
      dimension,
      new Set(requirements.flatMap((entry) => entry.coverage[dimension])),
    ]),
  );
  for (const value of ['dedicated', 'shared']) {
    assert.ok(represented.topologies.has(value), `coverage manifest omits topology: ${value}`);
  }
  for (const value of ['engine_wide', 'resource_aware']) {
    assert.ok(represented.runtimeAccessModes.has(value), `coverage manifest omits runtime mode: ${value}`);
  }
  for (const value of ['user', 'group-derived-user', 'api-client', 'service-account']) {
    assert.ok(represented.principals.has(value), `coverage manifest omits principal: ${value}`);
  }
  for (const value of ['manual-api', 'external-api', 'configuration-bundle', 'ui']) {
    assert.ok(represented.provisioningChannels.has(value), `coverage manifest omits provisioning channel: ${value}`);
  }
  for (const value of ['allow', 'deny', 'quarantine', 'conflict', 'audit']) {
    assert.ok(represented.outcomes.has(value), `coverage manifest omits outcome: ${value}`);
  }
});

test('inventories every public tenancy operation, stable error, and topology transition', () => {
  const ids = new Set(requirements.map((entry) => entry.id));
  const openApi = fs.readFileSync(openApiPath, 'utf8');
  const engineSchema = fs.readFileSync(engineSchemaPath, 'utf8');
  const transitionPolicy = fs.readFileSync(transitionPolicyPath, 'utf8');

  assertRequirementReferences(manifest.publicOperations, ids, 'publicOperations');
  const operationKeys = new Set();
  for (const operation of manifest.publicOperations) {
    assert.match(operation.method, /^(GET|POST|PUT|PATCH|DELETE)$/);
    assert.match(operation.path, /^\//);
    const operationKey = `${operation.method} ${operation.path}`;
    assert.ok(!operationKeys.has(operationKey), `duplicate public operation: ${operationKey}`);
    operationKeys.add(operationKey);
    const method = operation.method.toLowerCase();
    const escapedPath = operation.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      openApi,
      new RegExp(`method:\\s*'${method}',\\s*path:\\s*'${escapedPath}'`),
      `public tenancy operation is absent from OpenAPI: ${operationKey}`,
    );
  }

  assertRequirementReferences(manifest.stableErrors, ids, 'stableErrors');
  const errorEnum = engineSchema.match(/EngineTenancyErrorCodeSchema = z\.enum\(\[([\s\S]*?)\]\);/);
  assert.ok(errorEnum, 'canonical EngineTenancyErrorCodeSchema enum is missing');
  const schemaErrorCodes = [...errorEnum[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(
    manifest.stableErrors.map((entry) => entry.code),
    schemaErrorCodes,
    'stable error inventory must exactly match the canonical schema enum',
  );
  for (const error of manifest.stableErrors) {
    assert.ok(
      error.requirementIds.some((id) => {
        const entry = requirements.find((candidate) => candidate.id === id);
        return fs.readFileSync(path.join(root, entry.testFile), 'utf8').includes(error.code);
      }),
      `${error.code} has no linked executable test source`,
    );
  }

  assertRequirementReferences(manifest.supportedTransitions, ids, 'supportedTransitions');
  assertRequirementReferences(manifest.invalidTransitionCases, ids, 'invalidTransitionCases');
  const transitionKinds = [
    'dedicated_to_shared',
    'shared_to_dedicated',
    'shared_strategy_change',
    'dedicated_tenant_move',
  ];
  assert.deepEqual(manifest.supportedTransitions.map((entry) => entry.kind), transitionKinds);
  for (const kind of transitionKinds) {
    assert.ok(transitionPolicy.includes(`return '${kind}'`), `transition policy is missing ${kind}`);
  }
  assert.deepEqual(manifest.invalidTransitionCases.map((entry) => entry.kind), ['no_change']);
  assert.ok(transitionPolicy.includes('return null;'), 'equivalent/invalid transition rejection is missing');
});

test('requires every named security mutation fault class and cross-browser target', () => {
  const mutationRunner = fs.readFileSync(mutationRunnerPath, 'utf8');
  assert.deepEqual(manifest.requiredMutationFaultClasses, [
    'removed-tenant-filter',
    'inverted-ownership-check',
    'accepted-null-tenant-context',
    'skipped-mapping-version-check',
    'upstream-call-after-denial',
  ]);
  for (const faultClass of manifest.requiredMutationFaultClasses) {
    assert.ok(mutationRunner.includes(`faultClass: '${faultClass}'`), `mutation runner is missing ${faultClass}`);
  }

  const browserWorkflow = fs.readFileSync(path.join(root, '.github/workflows/authz-pr.yml'), 'utf8');
  for (const browser of manifest.supportedBrowsers) {
    assert.ok(browserWorkflow.includes(`"${browser}"`) || browserWorkflow.includes(`browser: ${browser}`), `browser gate is missing ${browser}`);
  }
});
