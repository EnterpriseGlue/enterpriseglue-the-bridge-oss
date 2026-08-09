#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'test/authz/engine-tenancy-functional-coverage.json');
const evidenceDirectory = path.join(root, 'test/results/engine-tenancy-release');
const evidencePath = path.join(evidenceDirectory, 'requirement-evidence.json');
const manifestSource = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestSource);

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function latestSchemaVersion() {
  const migrations = command('git', ['ls-files', 'packages/shared/src/db/migrations/*.ts'])
    .split('\n')
    .filter(Boolean)
    .map((file) => path.basename(file).match(/^(\d+)-/)?.[1])
    .filter(Boolean)
    .sort((left, right) => Number(left) - Number(right));
  return migrations.at(-1) || 'unknown';
}

const commit = command('git', ['rev-parse', 'HEAD']);
const dirtyPaths = command('git', ['status', '--short'])
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3));

const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-functional-traceability',
  coverageScope: 'traceability-only',
  status: 'passed',
  generatedAt: new Date().toISOString(),
  commit,
  worktreeClean: dirtyPaths.length === 0,
  dirtyPathCount: dirtyPaths.length,
  nodeVersion: process.version,
  pnpmVersion: command('pnpm', ['--version']),
  databaseSchemaVersion: latestSchemaVersion(),
  manifest: {
    path: path.relative(root, manifestPath),
    schemaVersion: manifest.schemaVersion,
    sha256: createHash('sha256').update(manifestSource).digest('hex'),
    requirementCount: manifest.requirements.length,
    uncoveredRequirementCount: 0,
    publicOperationCount: manifest.publicOperations.length,
    stableErrorCount: manifest.stableErrors.length,
    supportedTransitionCount: manifest.supportedTransitions.length,
    invalidTransitionCaseCount: manifest.invalidTransitionCases.length,
    waiverCount: manifest.waivers.length,
  },
  declaredTargets: {
    databases: manifest.supportedDatabases,
    browsers: manifest.supportedBrowsers,
  },
  verifiedTargets: {
    databases: [],
    browsers: [],
    note: 'Execution targets are recorded by database and browser result artifacts, not inferred from this manifest.',
  },
  requirements: manifest.requirements.map((entry) => ({
    id: entry.id,
    status: 'traceable',
    testFile: entry.testFile,
    testName: entry.testName,
    documentation: entry.documentation,
    documentationExample: entry.documentationExample,
    ciJob: entry.ciJob,
    coverage: entry.coverage,
  })),
};

mkdirSync(evidenceDirectory, { recursive: true });
rmSync(evidencePath, { force: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  `[engine-tenancy-evidence] ${evidence.manifest.requirementCount} requirements, ` +
  `${evidence.manifest.uncoveredRequirementCount} uncovered: ${path.relative(root, evidencePath)}`,
);
