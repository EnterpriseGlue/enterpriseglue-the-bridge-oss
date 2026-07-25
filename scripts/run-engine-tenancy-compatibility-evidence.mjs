#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'compatibility-window.json');
const allowDirty = process.argv.includes('--allow-dirty');
const safeEnvironment = { ...process.env };
for (const key of [
  'DATABASE_TYPE',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_SCHEMA',
  'POSTGRES_SSL',
  'POSTGRES_SSL_REJECT_UNAUTHORIZED',
  'JWT_SECRET',
  'ADMIN_PASSWORD',
  'ENCRYPTION_KEY',
  'FRONTEND_URL',
]) {
  delete safeEnvironment[key];
}
safeEnvironment.EG_ENV_FILE = path.join(root, 'scripts/local-safe-test.env');

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const startCommit = command('git', ['rev-parse', 'HEAD']);
const startChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startChanges && !allowDirty) {
  throw new Error('Compatibility-window evidence must be run from a clean worktree');
}

const routeTestFile = '__tests__/modules/mission-control/engines/routes.test.ts';
const contractTestFiles = [
  '__tests__/shared/services/platform-admin/engineTenancyProvisioningService.test.ts',
  '__tests__/shared/schemas/mission-control/engineRegistrationOpenApi.test.ts',
];
const routeResult = spawnSync('pnpm', [
  'run',
  'test:engine-tenancy:engine-routes',
], {
  cwd: root,
  env: safeEnvironment,
  stdio: 'inherit',
});
if (routeResult.error) throw routeResult.error;
if ((routeResult.status ?? 1) !== 0) {
  throw new Error('Engine-tenancy compatibility route tests failed');
}

const contractResult = spawnSync('pnpm', [
  '--dir',
  'backend',
  'exec',
  'vitest',
  'run',
  ...contractTestFiles,
  '--config',
  'vitest.config.ts',
  '--maxWorkers=1',
  '--no-file-parallelism',
  '--reporter=dot',
], {
  cwd: root,
  env: safeEnvironment,
  stdio: 'inherit',
});
if (contractResult.error) throw contractResult.error;
if ((contractResult.status ?? 1) !== 0) {
  throw new Error('Engine-tenancy compatibility removal tests failed');
}

const endCommit = command('git', ['rev-parse', 'HEAD']);
const endChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startCommit !== endCommit || (!allowDirty && endChanges)) {
  throw new Error('Source changed while compatibility-window evidence was running');
}

const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-compatibility-window',
  status: 'passed',
  generatedAt: new Date().toISOString(),
  commit: endCommit,
  sourceState: endChanges ? 'dirty-development-run' : 'clean',
  releaseCommitQualified: endChanges.length === 0,
  warningBehaviorTestsPassed: true,
  warningBehavior: 'removed',
  removalProposed: true,
  windowClosed: true,
  replacementDocumentationPublished: true,
  decision:
    'The announced breaking-release cutover is complete: external engine registration requires an explicit tenancy declaration and never defaults a missing value.',
  verifiedBehavior: [
    'external API-client omission is rejected before registration state is read or written',
    'explicit dedicated and shared declarations resolve through the authorized tenant reference path',
    'idempotent external upserts preserve their explicit topology declaration',
    'HTTP responses and OpenAPI no longer expose a compatibility warning',
  ],
  tests: [routeTestFile, ...contractTestFiles]
    .map((testFile) => ({ testFile: `backend/${testFile}`, status: 'passed' })),
  documentation: [
    'docs/reference/engine-tenancy-compatibility-and-deprecation.md',
    'docs/how-to/upgrade-engine-tenancy.md',
    'docs/how-to/provision-engines-externally.md',
  ],
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
console.log(`[engine-tenancy-compatibility] explicit-tenancy cutover evidence: ${path.relative(root, outputPath)}`);
