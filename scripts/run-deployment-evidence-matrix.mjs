#!/usr/bin/env node

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const defaultManifestPath = path.join(root, 'test/authz/deployment-evidence-matrix.json');
const allowedEnvironmentClasses = new Set([
  'local_contract',
  'local_emulator',
  'local_container',
  'external_openshift',
]);
const allowedGates = new Set(['pull_request', 'local_release', 'release']);
const laneIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const coverageIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function commandOutput(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateMatrix(matrix, packageScripts, repositoryRoot = root) {
  assertion(matrix && typeof matrix === 'object' && !Array.isArray(matrix), 'Evidence matrix must be an object');
  assertion(matrix.schemaVersion === 1, 'Evidence matrix schemaVersion must be 1');
  assertion(matrix.evidenceKind === 'access-governance-deployment', 'Evidence matrix kind is unsupported');
  assertion(/^test\/results\/[a-z0-9/-]+$/.test(matrix.artifactRoot || ''), 'artifactRoot must stay below test/results');
  assertion(Array.isArray(matrix.requiredCoverage) && matrix.requiredCoverage.length > 0, 'requiredCoverage must be non-empty');
  assertion(new Set(matrix.requiredCoverage).size === matrix.requiredCoverage.length, 'requiredCoverage contains duplicates');
  matrix.requiredCoverage.forEach((id) => assertion(coverageIdPattern.test(id), `Invalid coverage id ${id}`));
  assertion(Array.isArray(matrix.lanes) && matrix.lanes.length > 0, 'lanes must be non-empty');

  const requiredCoverage = new Set(matrix.requiredCoverage);
  const laneIds = new Set();
  const coverageCounts = new Map(matrix.requiredCoverage.map((id) => [id, 0]));
  for (const lane of matrix.lanes) {
    assertion(lane && typeof lane === 'object' && !Array.isArray(lane), 'Every lane must be an object');
    assertion(laneIdPattern.test(lane.id || ''), `Invalid lane id ${lane.id}`);
    assertion(!laneIds.has(lane.id), `Duplicate lane id ${lane.id}`);
    laneIds.add(lane.id);
    assertion(typeof lane.title === 'string' && lane.title.length >= 5, `${lane.id} requires a title`);
    assertion(allowedEnvironmentClasses.has(lane.environmentClass), `${lane.id} has an invalid environmentClass`);
    assertion(Array.isArray(lane.gates) && lane.gates.length > 0, `${lane.id} requires gates`);
    assertion(new Set(lane.gates).size === lane.gates.length, `${lane.id} contains duplicate gates`);
    lane.gates.forEach((gate) => assertion(allowedGates.has(gate), `${lane.id} has invalid gate ${gate}`));
    assertion(lane.gates.includes('release'), `${lane.id} must contribute to the release gate`);
    assertion(Array.isArray(lane.prerequisites) && lane.prerequisites.length > 0, `${lane.id} requires prerequisites`);
    assertion(Array.isArray(lane.artifacts) && lane.artifacts.length > 0, `${lane.id} requires artifact descriptions`);
    assertion(lane.artifacts.some((artifact) => /sanitized lane receipt/i.test(artifact)), `${lane.id} must retain a sanitized lane receipt`);
    assertion(Array.isArray(lane.successCriteria) && lane.successCriteria.length > 0, `${lane.id} requires success criteria`);
    assertion(Array.isArray(lane.covers) && lane.covers.length > 0, `${lane.id} requires coverage ids`);
    assertion(new Set(lane.covers).size === lane.covers.length, `${lane.id} contains duplicate coverage ids`);
    assertion(Number.isInteger(lane.timeoutMinutes) && lane.timeoutMinutes >= 1 && lane.timeoutMinutes <= 120, `${lane.id} has invalid timeoutMinutes`);

    for (const coverageId of lane.covers) {
      assertion(requiredCoverage.has(coverageId), `${lane.id} references unknown coverage ${coverageId}`);
      coverageCounts.set(coverageId, (coverageCounts.get(coverageId) || 0) + 1);
    }

    if (lane.environmentClass === 'external_openshift') {
      assertion(!lane.script, `${lane.id} external evidence cannot claim a local script`);
      assertion(
        typeof lane.externalProcedure === 'string' && lane.externalProcedure.startsWith('docs/') && lane.externalProcedure.endsWith('.md'),
        `${lane.id} requires an externalProcedure`,
      );
      assertion(existsSync(path.join(repositoryRoot, lane.externalProcedure)), `${lane.id} external procedure does not exist`);
      assertion(lane.gates.length === 1 && lane.gates[0] === 'release', `${lane.id} must remain an explicit release-only external gate`);
    } else {
      assertion(typeof lane.script === 'string' && lane.script.startsWith('test:'), `${lane.id} requires a test script`);
      assertion(Boolean(packageScripts[lane.script]), `${lane.id} references missing package script ${lane.script}`);
      assertion(!lane.externalProcedure, `${lane.id} cannot declare an external procedure`);
      if (lane.gates.includes('pull_request')) {
        assertion(lane.environmentClass === 'local_contract', `${lane.id} pull-request lanes must be local_contract`);
      }
    }
  }

  for (const [coverageId, count] of coverageCounts) {
    assertion(count > 0, `Required coverage ${coverageId} has no lane`);
  }
  assertion(
    matrix.lanes.some((lane) => lane.environmentClass === 'local_emulator' && lane.covers.includes('identity.oidc_entra') && lane.covers.includes('identity.saml') && lane.covers.includes('identity.ldap')),
    'One local emulator lane must cover OIDC/Entra, SAML, and LDAP',
  );
  assertion(
    matrix.lanes.some((lane) => lane.environmentClass === 'local_container' && lane.id.includes('operaton-direct')),
    'A real Operaton direct container lane is required',
  );
  assertion(
    matrix.lanes.some((lane) => lane.environmentClass === 'local_container' && lane.id.includes('operaton-sidecar')),
    'A real Operaton customer-sidecar container lane is required',
  );
  assertion(
    matrix.lanes.some((lane) => lane.environmentClass === 'external_openshift' && lane.covers.includes('openshift.failed_rollout_retention')),
    'Real OpenShift failed-rollout retention must remain an external gate',
  );
  return matrix;
}

function parseArguments(argv) {
  const valueFor = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    validateOnly: argv.includes('--validate-only'),
    indexOnly: argv.includes('--index-only'),
    dryRun: argv.includes('--dry-run'),
    profile: valueFor('--profile') || 'pr',
    manifestPath: path.resolve(valueFor('--manifest') || defaultManifestPath),
    resultsDirectory: valueFor('--results-dir') ? path.resolve(valueFor('--results-dir')) : null,
  };
}

function selectedEnvironmentClasses(profile) {
  if (profile === 'pr') return new Set(['local_contract']);
  if (profile === 'emulator') return new Set(['local_emulator']);
  if (profile === 'container') return new Set(['local_container']);
  if (profile === 'all-local') return new Set(['local_contract', 'local_emulator', 'local_container']);
  throw new Error(`Unsupported evidence profile ${profile}`);
}

function receiptPath(resultsDirectory, laneId) {
  return path.join(resultsDirectory, 'lanes', `${laneId}.json`);
}

function safeReceipt(lane, result, context) {
  return {
    schemaVersion: 1,
    evidenceKind: 'access-governance-deployment-lane',
    laneId: lane.id,
    environmentClass: lane.environmentClass,
    status: result.status,
    failureCode: result.failureCode || null,
    commit: context.commit,
    sourceState: context.sourceState,
    manifestHash: context.manifestHash,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    command: lane.script ? `pnpm run ${lane.script}` : null,
    covers: lane.covers,
    artifacts: lane.artifacts,
    successCriteria: lane.successCriteria,
    containsCredentials: false,
    containsTokens: false,
  };
}

function readLaneReceipt(filePath, lane, context) {
  if (!existsSync(filePath)) {
    return {
      id: lane.id,
      environmentClass: lane.environmentClass,
      status: 'pending',
      reason: lane.environmentClass === 'external_openshift'
        ? 'external environment evidence has not been recorded'
        : 'lane has not been executed for this commit',
    };
  }
  try {
    const receipt = readJson(filePath);
    const valid = receipt.schemaVersion === 1
      && receipt.evidenceKind === 'access-governance-deployment-lane'
      && receipt.laneId === lane.id
      && receipt.environmentClass === lane.environmentClass
      && receipt.commit === context.commit
      && receipt.manifestHash === context.manifestHash
      && receipt.containsCredentials === false
      && receipt.containsTokens === false
      && ['passed', 'failed'].includes(receipt.status);
    if (!valid) {
      return { id: lane.id, environmentClass: lane.environmentClass, status: 'invalid', reason: 'receipt is stale, mismatched, or unsanitized' };
    }
    return {
      id: lane.id,
      environmentClass: lane.environmentClass,
      status: receipt.status,
      reason: receipt.failureCode,
      receipt: path.relative(root, filePath),
    };
  } catch {
    return { id: lane.id, environmentClass: lane.environmentClass, status: 'invalid', reason: 'receipt is not valid JSON' };
  }
}

export function buildEvidenceIndex(matrix, resultsDirectory, context) {
  const lanes = matrix.lanes.map((lane) => readLaneReceipt(receiptPath(resultsDirectory, lane.id), lane, context));
  const gateStatus = {};
  for (const gate of allowedGates) {
    const requiredLaneIds = matrix.lanes.filter((lane) => lane.gates.includes(gate)).map((lane) => lane.id);
    const results = lanes.filter((lane) => requiredLaneIds.includes(lane.id));
    gateStatus[gate] = {
      status: results.every((result) => result.status === 'passed')
        ? 'passed'
        : results.some((result) => ['failed', 'invalid'].includes(result.status))
          ? 'failed'
          : 'pending',
      requiredLaneCount: results.length,
      passedLaneCount: results.filter((result) => result.status === 'passed').length,
      pendingLaneIds: results.filter((result) => result.status === 'pending').map((result) => result.id),
      failedLaneIds: results.filter((result) => ['failed', 'invalid'].includes(result.status)).map((result) => result.id),
    };
  }
  const external = lanes.filter((lane) => lane.environmentClass === 'external_openshift');
  const index = {
    schemaVersion: 1,
    evidenceKind: matrix.evidenceKind,
    status: gateStatus.release.status === 'passed' ? 'passed' : gateStatus.release.status === 'failed' ? 'failed' : 'incomplete',
    releaseStatus: gateStatus.release.status === 'passed' && context.sourceState === 'clean'
      ? 'release-qualified'
      : gateStatus.release.status === 'failed'
        ? 'failed'
        : 'pending-evidence',
    generatedAt: new Date().toISOString(),
    commit: context.commit,
    sourceState: context.sourceState,
    manifestHash: context.manifestHash,
    releaseCommitQualified: gateStatus.release.status === 'passed' && context.sourceState === 'clean',
    externalEvidenceComplete: external.length > 0 && external.every((lane) => lane.status === 'passed'),
    pendingExternalLaneIds: external.filter((lane) => lane.status !== 'passed').map((lane) => lane.id),
    gateStatus,
    coverage: Object.fromEntries(matrix.requiredCoverage.map((coverageId) => {
      const covering = matrix.lanes.filter((lane) => lane.covers.includes(coverageId)).map((lane) => lane.id);
      const passed = lanes.filter((lane) => covering.includes(lane.id) && lane.status === 'passed').map((lane) => lane.id);
      return [coverageId, { requiredLaneIds: covering, passedLaneIds: passed }];
    })),
    lanes,
    containsCredentials: false,
    containsTokens: false,
  };
  mkdirSync(resultsDirectory, { recursive: true });
  writeFileSync(path.join(resultsDirectory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  return index;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifestSource = readFileSync(options.manifestPath, 'utf8');
  const matrix = JSON.parse(manifestSource);
  const packageScripts = readJson(path.join(root, 'package.json')).scripts || {};
  validateMatrix(matrix, packageScripts);
  const resultsDirectory = options.resultsDirectory || path.join(root, matrix.artifactRoot);
  const context = {
    commit: commandOutput('git', ['rev-parse', 'HEAD']),
    sourceState: commandOutput('git', ['status', '--porcelain', '--untracked-files=no']) ? 'dirty-development-run' : 'clean',
    manifestHash: sha256(manifestSource),
  };

  if (options.validateOnly) {
    console.log(`[deployment-evidence] matrix valid (${matrix.lanes.length} lanes, ${matrix.requiredCoverage.length} required coverage ids)`);
    return;
  }
  if (!options.indexOnly) {
    const classes = selectedEnvironmentClasses(options.profile);
    const selected = matrix.lanes.filter((lane) => classes.has(lane.environmentClass));
    console.log(`[deployment-evidence] profile=${options.profile}; selected=${selected.length}; external evidence remains pending until explicitly recorded`);
    if (!options.dryRun) {
      mkdirSync(path.join(resultsDirectory, 'lanes'), { recursive: true });
      for (const lane of selected) {
        const started = Date.now();
        console.log(`[deployment-evidence] running ${lane.id}: pnpm run ${lane.script}`);
        const child = spawnSync('pnpm', ['run', lane.script], {
          cwd: root,
          env: process.env,
          stdio: 'inherit',
          timeout: lane.timeoutMinutes * 60 * 1000,
        });
        const completed = Date.now();
        const passed = !child.error && child.status === 0;
        const receipt = safeReceipt(lane, {
          status: passed ? 'passed' : 'failed',
          failureCode: child.error?.code === 'ETIMEDOUT' ? 'timeout' : passed ? null : 'command_failed',
          startedAt: new Date(started).toISOString(),
          completedAt: new Date(completed).toISOString(),
          durationMs: completed - started,
        }, context);
        writeFileSync(receiptPath(resultsDirectory, lane.id), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
        if (!passed) {
          buildEvidenceIndex(matrix, resultsDirectory, context);
          throw new Error(`${lane.id} failed; only the sanitized failed receipt was retained`);
        }
      }
    }
  }

  const index = buildEvidenceIndex(matrix, resultsDirectory, context);
  const requestedGate = options.profile === 'pr' ? 'pull_request' : options.profile === 'all-local' ? 'local_release' : null;
  if (requestedGate && !options.dryRun && index.gateStatus[requestedGate].status !== 'passed') {
    throw new Error(`${requestedGate} evidence gate is ${index.gateStatus[requestedGate].status}`);
  }
  console.log(`[deployment-evidence] index=${path.relative(root, path.join(resultsDirectory, 'index.json'))}; release=${index.releaseStatus}; external=${index.externalEvidenceComplete ? 'passed' : 'pending'}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[deployment-evidence] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
