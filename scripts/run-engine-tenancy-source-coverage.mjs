#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'source-coverage.json');
const lanes = [
  {
    id: 'provisioning',
    script: 'test:engine-tenancy:provisioning',
    modules: ['EngineTenancyProvisioningService.ts'],
  },
  {
    id: 'mapping',
    script: 'test:engine-tenancy:mappings',
    modules: ['EngineTenantMappingService.ts'],
  },
  {
    id: 'tenant-role-policy',
    script: 'test:engine-tenancy:authorization',
    modules: ['tenant-role-policy.ts'],
  },
  {
    id: 'runtime-enforcement',
    script: 'test:engine-tenancy:runtime',
    modules: ['requireAction.ts', 'runtime-resource-filter.ts'],
  },
  {
    id: 'transition-policy',
    script: 'test:engine-tenancy:transitions',
    modules: ['classification-policy.ts', 'transition-policy.ts'],
  },
  {
    id: 'operational-metrics',
    script: 'test:engine-tenancy:operations',
    modules: ['operational-metrics.ts', 'engineTenancyMetrics.ts'],
  },
  {
    id: 'machine-principals',
    script: 'test:authz:machine-principal-coverage',
    modules: ['ApiClientService.ts', 'ServiceAccountService.ts'],
  },
  {
    id: 'policy-service',
    script: 'test:authz:policy-coverage',
    modules: ['PolicyService.ts'],
  },
  {
    id: 'api-client-middleware',
    script: 'test:authz:api-client-middleware-coverage',
    modules: ['apiClientAuth.ts'],
  },
];

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const startCommit = command('git', ['rev-parse', 'HEAD']);
const startChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startChanges) {
  throw new Error('Source-coverage evidence must be run from a clean worktree');
}

const results = [];
for (const lane of lanes) {
  console.log(`[engine-tenancy-source-coverage] running ${lane.script}`);
  const result = spawnSync('pnpm', ['run', lane.script], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${lane.script} did not meet its literal 100% coverage threshold`);
  }
  results.push({
    ...lane,
    status: 'passed',
    thresholds: {
      lines: 100,
      statements: 100,
      branches: 100,
      functions: 100,
    },
  });
}

const endCommit = command('git', ['rev-parse', 'HEAD']);
const endChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startCommit !== endCommit || endChanges) {
  throw new Error('Source changed while coverage evidence was running');
}

const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-security-critical-source-coverage',
  coverageScope: 'security-critical-modules-only',
  status: 'passed',
  generatedAt: new Date().toISOString(),
  commit: endCommit,
  sourceState: 'clean',
  releaseCommitQualified: true,
  totals: {
    lines: 100,
    statements: 100,
    branches: 100,
    functions: 100,
  },
  lanes: results,
  moduleCount: new Set(results.flatMap((result) => result.modules)).size,
  rule: 'Each lane exits successfully only when Vitest reports literal per-file 100% lines, statements, branches, and functions for every listed module.',
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
console.log(`[engine-tenancy-source-coverage] ${evidence.moduleCount} modules: ${path.relative(root, outputPath)}`);
