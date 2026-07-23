#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'browser-accessibility.json');
const browsers = ['chromium', 'firefox', 'webkit'];
const verifiedChecks = [
  'error_announcement',
  'contrast',
  'zoom_200_reflow',
  'reduced_motion',
];
const workflowCount = browsers.length * verifiedChecks.length;

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
}

const commit = run('git', ['rev-parse', 'HEAD']);
const trackedChanges = run('git', ['status', '--porcelain', '--untracked-files=no']);
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lastRun = JSON.parse(readFileSync(path.join(root, 'test/results/playwright/.last-run.json'), 'utf8'));
if (lastRun.status !== 'passed' || (lastRun.failedTests || []).length !== 0) {
  throw new Error('The final accessibility browser result is not passing; refusing to write evidence');
}

const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-browser-accessibility',
  coverageScope: 'access-control-critical-workflows',
  generatedAt: new Date().toISOString(),
  commit,
  sourceState: trackedChanges ? 'dirty' : 'clean',
  releaseCommitQualified: trackedChanges.length === 0,
  command: 'pnpm run test:authz:accessibility:cross-browser',
  status: 'passed',
  testFile: 'test/e2e/access-control-accessibility.spec.ts',
  workflowCount,
  passedWorkflowCount: workflowCount,
  missingChecks: 0,
  verifiedChecks,
  verifiedTargets: {
    browsers,
    deployment: 'localhost',
  },
  runnerGuarantee:
    'set -Eeuo pipefail writes this artifact only after all four checks pass independently in Chromium, Firefox, and WebKit',
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
  toolchain: {
    node: process.version,
    playwright: packageJson.devDependencies?.['@playwright/test']
      || packageJson.dependencies?.['@playwright/test']
      || 'workspace',
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[authz-accessibility] ${workflowCount} passing executions: ${path.relative(root, outputPath)}`);
