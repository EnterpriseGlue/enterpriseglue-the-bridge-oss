#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const matrixPath = path.join(root, 'test/authz/deployment-evidence-matrix.json');
const requiredChecks = [
  'configmap_secret_rendered',
  'new_rollout_failed_closed',
  'previous_replica_set_available',
  'recovery_rollout_succeeded',
  'sanitized_readiness_retained',
];
const allowedInputKeys = new Set([
  'schemaVersion',
  'laneId',
  'commit',
  'executedAt',
  'environmentClass',
  'checks',
  'artifacts',
]);
const forbiddenKeyPattern = /(password|secret|token|authorization|cookie|credential|claim|email|user|host|route|namespace|cluster|endpoint|url|ip)/i;
const suspiciousValuePattern = /(bearer\s+[a-z0-9._~-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----|eg(?:ac|sa)_[a-z0-9_-]+|password\s*[:=])/i;

function fail(message) {
  throw new Error(message);
}

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function assertSanitized(value, pathParts = []) {
  if (typeof value === 'string') {
    if (suspiciousValuePattern.test(value)) fail(`External evidence contains a sensitive-looking value at ${pathParts.join('.')}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitized(item, [...pathParts, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const declaredCheck = pathParts.length === 1 && pathParts[0] === 'checks' && requiredChecks.includes(key);
    if (!declaredCheck && forbiddenKeyPattern.test(key)) fail(`External evidence contains forbidden field ${[...pathParts, key].join('.')}`);
    assertSanitized(child, [...pathParts, key]);
  }
}

function main() {
  if (process.env.DEPLOYMENT_EVIDENCE_EXTERNAL_GATE !== 'openshift') {
    fail('Set DEPLOYMENT_EVIDENCE_EXTERNAL_GATE=openshift only inside the dedicated OpenShift evidence environment');
  }
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) fail('Usage: record-deployment-external-evidence.mjs --input <sanitized-json>');
  const inputPath = path.resolve(process.argv[inputIndex + 1]);
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  for (const key of Object.keys(input)) {
    if (!allowedInputKeys.has(key)) fail(`External evidence contains unknown top-level field ${key}`);
  }
  assertSanitized(input);

  const matrixSource = readFileSync(matrixPath, 'utf8');
  const matrix = JSON.parse(matrixSource);
  const lane = matrix.lanes.find((candidate) => candidate.id === 'external-openshift-rollout');
  if (!lane || lane.environmentClass !== 'external_openshift') fail('OpenShift external lane is not declared by the evidence matrix');
  const commit = command('git', ['rev-parse', 'HEAD']);
  const changes = command('git', ['status', '--porcelain', '--untracked-files=no']);
  if (changes) fail('External OpenShift evidence must be recorded from the exact clean candidate commit');
  if (input.schemaVersion !== 1 || input.laneId !== lane.id || input.environmentClass !== lane.environmentClass) {
    fail('External evidence identity does not match the OpenShift lane');
  }
  if (input.commit !== commit) fail('External evidence commit does not match the checked-out candidate');
  if (!Number.isFinite(Date.parse(input.executedAt))) fail('External evidence requires an ISO executedAt timestamp');
  if (!input.checks || Object.keys(input.checks).sort().join(',') !== [...requiredChecks].sort().join(',')) {
    fail('External evidence must contain exactly the required OpenShift checks');
  }
  for (const check of requiredChecks) {
    if (input.checks[check] !== true) fail(`External OpenShift check did not pass: ${check}`);
  }
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) fail('External evidence requires at least one artifact digest');
  for (const artifact of input.artifacts) {
    if (!artifact || typeof artifact !== 'object' || !/^[a-z][a-z0-9-]+$/.test(artifact.id || '') || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) {
      fail('External artifact references must contain only a stable id and SHA-256 digest');
    }
    if (Object.keys(artifact).sort().join(',') !== 'id,sha256') fail('External artifact references reject names, paths, URLs, and environment metadata');
  }

  const resultsDirectory = path.join(root, matrix.artifactRoot);
  const laneDirectory = path.join(resultsDirectory, 'lanes');
  mkdirSync(laneDirectory, { recursive: true });
  const receipt = {
    schemaVersion: 1,
    evidenceKind: 'access-governance-deployment-lane',
    laneId: lane.id,
    environmentClass: lane.environmentClass,
    status: 'passed',
    failureCode: null,
    commit,
    sourceState: 'clean',
    manifestHash: createHash('sha256').update(matrixSource).digest('hex'),
    startedAt: input.executedAt,
    completedAt: input.executedAt,
    durationMs: null,
    command: null,
    covers: lane.covers,
    artifacts: lane.artifacts,
    successCriteria: lane.successCriteria,
    evidenceDigests: input.artifacts,
    containsCredentials: false,
    containsTokens: false,
  };
  const receiptPath = path.join(laneDirectory, `${lane.id}.json`);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`[deployment-evidence] recorded sanitized OpenShift receipt ${path.relative(root, receiptPath)}`);
}

try {
  main();
} catch (error) {
  console.error(`[deployment-evidence] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
