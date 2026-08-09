import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contract = JSON.parse(readFileSync(new URL('../test/database/engine-tenancy-database-matrix-contract.json', import.meta.url), 'utf8'));
const databaseCount = Object.keys(contract.databases).length;
const baselineCount = contract.upgradeBaselines.length;
const stageCount = contract.requiredStages.length;
const baselineObservations = databaseCount * baselineCount;
const stageCells = databaseCount * stageCount;

const documentationFiles = [
  '../docs/reference/database-architecture.md',
  '../docs/how-to/provision-engines-externally.md',
  '../docs/development/engine-tenancy-database-qualification.md',
  '../docs/development/testing-engine-tenancy-and-access-control.md',
  '../docs/releases/engine-tenancy.md',
  '../docs/development/engine-tenancy-functional-test-report.md',
  '../docs/architecture/12-engine-tenancy-and-external-provisioning-plan.md',
];

const documents = documentationFiles.map((file) => ({
  file,
  text: readFileSync(new URL(file, import.meta.url), 'utf8'),
}));

test('database qualification denominator is derived from the matrix contract', () => {
  assert.equal(databaseCount, 5);
  assert.equal(baselineCount, 5);
  assert.equal(stageCells, 35);
  assert.equal(baselineObservations, 25);
});

test('database qualification documentation contains no stale two-baseline denominator', () => {
  const stalePatterns = [
    /both supported upgrade baselines/i,
    /two supported upgrade baselines/i,
    /10\/10 (?:supported-)?baseline/i,
    /all ten (?:adapter\/)?upgrade-baseline/i,
    /two baselines [×x] five adapters/i,
  ];

  for (const { file, text } of documents) {
    for (const pattern of stalePatterns) {
      assert.doesNotMatch(text, pattern, `${file} contains stale qualification denominator text`);
    }
  }
});

test('canonical qualification documents publish the current derived counts', () => {
  const runbook = documents.find(({ file }) => file.endsWith('engine-tenancy-database-qualification.md'))?.text || '';
  const report = documents.find(({ file }) => file.endsWith('engine-tenancy-functional-test-report.md'))?.text || '';
  assert.match(runbook, new RegExp(`${stageCells}/${stageCells} stage cells`));
  assert.match(runbook, new RegExp(`${baselineObservations}/${baselineObservations} baseline`));
  assert.match(report, new RegExp(`${baselineObservations}/${baselineObservations} adapter/upgrade-baseline observations`));
});
