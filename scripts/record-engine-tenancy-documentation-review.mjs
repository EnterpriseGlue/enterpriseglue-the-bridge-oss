#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  finalizeDocumentationReviewEvidence,
  isSafeDocumentationReviewEvidencePath,
  normalizeDocumentationReviewMode,
  normalizeDocumentationReviewRole,
} from './lib/engine-tenancy-documentation-review.mjs';

const root = process.cwd();
const artifactPath = path.join(
  root,
  'test/results/engine-tenancy-release/documentation-review.json',
);

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error('Every review option must use --name value syntax.');
    }
    if (values[flag] !== undefined) {
      throw new Error(`Duplicate option: ${flag}`);
    }
    values[flag] = value;
  }
  const allowed = new Set([
    '--review',
    '--reviewer',
    '--review-mode',
    '--evidence',
    '--reviewed-at',
  ]);
  const unknown = Object.keys(values).find((flag) => !allowed.has(flag));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  for (const required of ['--review', '--reviewer', '--review-mode', '--evidence']) {
    if (!values[required]?.trim()) throw new Error(`Missing required option: ${required}`);
  }
  return values;
}

const args = parseArguments(process.argv.slice(2));
const role = normalizeDocumentationReviewRole(args['--review']);
const reviewer = args['--reviewer'].trim();
const reviewMode = normalizeDocumentationReviewMode(args['--review-mode']);
const evidenceLocation = args['--evidence'].replaceAll('\\', '/');
const reviewedAt = args['--reviewed-at'] ?? new Date().toISOString();

if (Number.isNaN(Date.parse(reviewedAt))) {
  throw new Error('--reviewed-at must be a valid ISO date/time.');
}
if (!isSafeDocumentationReviewEvidencePath(evidenceLocation)) {
  throw new Error(
    '--evidence must be a repository-relative path under ' +
    'test/results/engine-tenancy-review/.',
  );
}

const trackedChanges = command('git', [
  'status',
  '--porcelain',
  '--untracked-files=no',
]);
if (trackedChanges) {
  throw new Error('Documentation approval must be recorded from a clean worktree');
}
const commit = command('git', ['rev-parse', 'HEAD']);
if (!existsSync(artifactPath)) {
  throw new Error(
    'Generate documentation-review evidence before recording an approval.',
  );
}

const evidenceAbsolutePath = path.resolve(root, evidenceLocation);
if (
  !existsSync(evidenceAbsolutePath)
  || !statSync(evidenceAbsolutePath).isFile()
) {
  throw new Error(`Review evidence file does not exist: ${evidenceLocation}`);
}

const evidence = JSON.parse(readFileSync(artifactPath, 'utf8'));
if (
  evidence.commit !== commit
  || evidence.sourceState !== 'clean'
  || evidence.automatedChecksPassed !== true
  || evidence.unresolvedHighRiskFindings !== 0
) {
  throw new Error(
    'Documentation-review evidence is stale, dirty, failed, or has unresolved high-risk findings.',
  );
}

evidence.reviews = {
  ...evidence.reviews,
  [role]: {
    status: 'approved',
    approvedCommit: commit,
    reviewer,
    reviewMode,
    reviewedAt: new Date(reviewedAt).toISOString(),
    evidenceLocation,
  },
};

const evidenceExists = (value) => {
  if (!isSafeDocumentationReviewEvidencePath(value)) return false;
  const absolutePath = path.resolve(root, value);
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
};
const finalized = finalizeDocumentationReviewEvidence(evidence, evidenceExists);
const temporaryPath = `${artifactPath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(finalized, null, 2)}\n`);
renameSync(temporaryPath, artifactPath);

const approved = Object.values(finalized.reviews)
  .filter((review) => review.status === 'approved').length;
console.log(
  `[engine-tenancy-documentation-review] recorded ${reviewMode} ${role} approval for ${commit}; ` +
  `${approved}/3 approvals complete`,
);
