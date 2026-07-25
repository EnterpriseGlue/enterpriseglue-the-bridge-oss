#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const observationPath = path.join(root, 'test/results/camunda-native-grant-browser-observations/workflow.json');
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'camunda-native-grant-browser.json');

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const commit = command('git', ['rev-parse', 'HEAD']);
const trackedChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (trackedChanges) {
  throw new Error('Native-grant browser evidence must be assembled from a clean worktree');
}
if (!existsSync(observationPath)) {
  throw new Error('Native-grant browser observation is missing; run the localhost Docker browser workflow first');
}

const observation = JSON.parse(readFileSync(observationPath, 'utf8'));
const requiredAssertions = [
  'read_only_native_inventory',
  'sanitized_preview_then_protected_mapping',
  'hash_bound_draft_and_apply',
  'sso_membership_effective_access_allow_and_sibling_deny',
  'history_resume_and_hash_bound_rollback',
  'rollback_restores_denial',
];
const assertionSet = new Set(observation.assertions || []);
const safeSanitization = observation.sanitization
  && Object.values(observation.sanitization).every((value) => value === false);
const valid = observation.schemaVersion === 1
  && observation.status === 'passed'
  && observation.commit === commit
  && observation.sourceState === 'clean'
  && observation.releaseCommitQualified === true
  && observation.localhostOnly === true
  && observation.realHttpService === true
  && observation.persistentDatabase === true
  && observation.authorizationEvaluator === true
  && observation.userInterface === true
  && requiredAssertions.every((assertion) => assertionSet.has(assertion))
  && safeSanitization;

const evidence = {
  schemaVersion: 1,
  evidenceKind: 'camunda-native-grant-browser-workflow',
  status: valid ? 'passed' : 'incomplete',
  generatedAt: new Date().toISOString(),
  commit,
  sourceState: 'clean',
  releaseCommitQualified: valid,
  command: 'pnpm run test:camunda-native-grant-browser-evidence',
  verifiedTargets: {
    browser: 'chromium',
    database: 'postgres',
    deployment: 'localhost-docker',
    source: 'synthetic-camunda7-native-authorizations',
  },
  assertions: requiredAssertions.map((assertion) => ({
    id: assertion,
    status: assertionSet.has(assertion) ? 'passed' : 'missing',
  })),
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
  runnerGuarantee: 'Evidence is emitted only after the authenticated UI workflow, protected route enforcement, source-managed membership, and rollback all pass on an exact clean local commit.',
};

if (!valid) {
  throw new Error('Native-grant browser observation is incomplete, stale, unsafe, or not release-commit qualified');
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`[camunda-native-grant-browser-evidence] workflow passed: ${path.relative(root, outputPath)}`);
