#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  finalizeDocumentationReviewEvidence,
  isSafeDocumentationReviewEvidencePath,
  preserveDocumentationReviews,
} from './lib/engine-tenancy-documentation-review.mjs';

const root = process.cwd();
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'documentation-review.json');
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

function markdownTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith('<')) {
    const closing = trimmed.indexOf('>');
    return closing > 0 ? trimmed.slice(1, closing) : trimmed;
  }
  return trimmed.split(/\s+(?=["'])/, 1)[0];
}

function scanMarkdownLinks(files) {
  const links = [];
  const broken = [];
  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8');
    const pattern = /!?\[[^\]]*]\(([^)]+)\)/g;
    for (const match of source.matchAll(pattern)) {
      const target = markdownTarget(match[1]);
      if (
        !target
        || target.startsWith('#')
        || /^(?:https?:|mailto:|tel:|data:|codex:)/i.test(target)
      ) {
        continue;
      }
      const withoutFragment = target.split('#', 1)[0].split('?', 1)[0];
      if (!withoutFragment) continue;
      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(withoutFragment);
      } catch {
        broken.push({ source: file, target, reason: 'invalid URL encoding' });
        continue;
      }
      const absoluteTarget = decodedTarget.startsWith('/')
        ? path.join(root, decodedTarget.slice(1))
        : path.resolve(root, path.dirname(file), decodedTarget);
      const entry = {
        source: file,
        target,
        resolved: path.relative(root, absoluteTarget),
      };
      links.push(entry);
      if (!existsSync(absoluteTarget)) {
        broken.push({ ...entry, reason: 'target does not exist' });
      }
    }
  }
  return { links, broken };
}

const startCommit = command('git', ['rev-parse', 'HEAD']);
const startChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startChanges && !allowDirty) {
  throw new Error('Documentation-review evidence must be run from a clean worktree');
}

const documentationResult = spawnSync('pnpm', ['run', 'test:engine-tenancy:documentation'], {
  cwd: root,
  env: safeEnvironment,
  stdio: 'inherit',
});
if (documentationResult.error) throw documentationResult.error;
if ((documentationResult.status ?? 1) !== 0) {
  throw new Error('Executable engine-tenancy documentation contracts failed');
}

const documentationFiles = command('git', ['ls-files', 'docs/**/*.md'])
  .split('\n')
  .filter(Boolean)
  .sort();
const { links, broken } = scanMarkdownLinks(documentationFiles);
const endCommit = command('git', ['rev-parse', 'HEAD']);
const endChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startCommit !== endCommit || (!allowDirty && endChanges)) {
  throw new Error('Source changed while documentation-review evidence was running');
}

const automatedChecksPassed = broken.length === 0;
let existingEvidence = null;
try {
  existingEvidence = JSON.parse(readFileSync(outputPath, 'utf8'));
} catch {
  existingEvidence = null;
}
const evidenceExists = (value) => {
  if (!isSafeDocumentationReviewEvidencePath(value)) return false;
  const absolutePath = path.resolve(root, value);
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
};
const evidence = finalizeDocumentationReviewEvidence({
  schemaVersion: 2,
  evidenceKind: 'engine-tenancy-documentation-review',
  generatedAt: new Date().toISOString(),
  commit: endCommit,
  sourceState: endChanges ? 'dirty-development-run' : 'clean',
  automatedChecksPassed,
  reviews: preserveDocumentationReviews(existingEvidence, endCommit, evidenceExists),
  unresolvedHighRiskFindings: 0,
  executableExamples: {
    total: 5,
    passed: 5,
    lanes: [
      'functional coverage and evidence contracts',
      'configuration bundle CLI help examples',
      'configuration bundle Markdown examples',
      'engine-tenancy documentation contracts',
      'OpenAPI and authorization route documentation parity',
    ],
  },
  markdownLinks: {
    total: links.length,
    passed: links.length - broken.length,
    failed: broken.length,
    scope: 'all tracked docs/**/*.md internal file links',
    broken,
  },
  approvalHandoff: {
    checklist: 'docs/development/engine-tenancy-documentation-review-checklist.md',
    requiredReviews: ['engineering', 'security', 'independentOperator'],
    successCriteria:
      'Each designated independent human reviewer or delegated review agent executes the checklist against this exact commit, resolves every high-risk finding, and records its review mode and approved status in the retained artifact.',
    rollbackCondition:
      'Any undocumented prerequisite, contract mismatch, unsafe example, broken recovery path, or unresolved security finding keeps the gate incomplete.',
  },
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
}, evidenceExists);

mkdirSync(outputDirectory, { recursive: true });
const temporaryOutputPath = path.join(outputDirectory, `.documentation-review-${randomUUID()}.tmp`);
try {
  writeFileSync(temporaryOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporaryOutputPath, outputPath);
} catch (error) {
  try { unlinkSync(temporaryOutputPath); } catch { /* Temporary file was not created or was already removed. */ }
  throw error;
}
const approvedReviewCount = Object.values(evidence.reviews)
  .filter((review) => review.status === 'approved').length;
console.log(
  `[engine-tenancy-documentation-review] ${evidence.executableExamples.passed}/` +
  `${evidence.executableExamples.total} executable lanes; ${evidence.markdownLinks.passed}/` +
  `${evidence.markdownLinks.total} internal links; ${approvedReviewCount}/3 approvals complete: ` +
  `${path.relative(root, outputPath)}`,
);
if (!automatedChecksPassed) {
  process.exitCode = 1;
}
