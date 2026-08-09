#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const playwrightDirectory = path.join(root, 'test/results/playwright');
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'local-enforcement.json');

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function findEvidenceFiles(directory) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findEvidenceFiles(entryPath));
    } else if (entry.name === 'engine-tenancy-local-evidence.json') {
      matches.push(entryPath);
    }
  }
  return matches;
}

const candidates = findEvidenceFiles(playwrightDirectory)
  .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
if (candidates.length === 0) {
  throw new Error('No passing Playwright engine-tenancy evidence was found');
}

const sourcePath = candidates[0];
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const appliedEngineIds = Array.isArray(source.appliedEngineIds) ? source.appliedEngineIds : [];
const metricsAssertions = source.metricsAssertions || {};
if (
  source.applyReadyRows !== true
  || appliedEngineIds.length !== 1
  || Object.values(metricsAssertions).some((value) => value !== true)
  || Number(source.finalTotals?.requiresReview || 0) !== 0
  || Number(source.finalTotals?.conflicts || 0) !== 0
) {
  throw new Error('Local engine-tenancy evidence is incomplete or did not pass every readiness assertion');
}

const commit = command('git', ['rev-parse', 'HEAD']);
const trackedChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-local-enforcement',
  coverageScope: 'executed-local-postgres-enforcement',
  status: 'passed',
  generatedAt: new Date().toISOString(),
  commit,
  sourceState: trackedChanges ? 'dirty' : 'clean',
  releaseCommitQualified: trackedChanges.length === 0,
  command: 'ENGINE_TENANCY_APPLY_READY=true pnpm run test:engine-tenancy:local-evidence',
  sourceArtifact: path.relative(root, sourcePath),
  verifiedTargets: {
    database: 'postgres',
    browser: 'chromium',
    deployment: 'localhost-docker',
  },
  assertions: {
    ownedLegacyRowsApplied: appliedEngineIds.length,
    readyForApplyAfterOwnedApply: Number(source.classifiedTotals?.readyForApply || 0),
    requiresReview: Number(source.finalTotals?.requiresReview || 0),
    conflicts: Number(source.finalTotals?.conflicts || 0),
    metrics: metricsAssertions,
    dedicatedDefaultTenant: source.dedicated?.tenantId === 'tenant-default',
    sharedResolvedAfterMapping: source.mappedDiagnostics?.resolutionStatus === 'ready',
  },
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[engine-tenancy-local-evidence] passing evidence: ${path.relative(root, outputPath)}`);
