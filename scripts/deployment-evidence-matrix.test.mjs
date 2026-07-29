import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildEvidenceIndex,
  validateMatrix,
} from './run-deployment-evidence-matrix.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifestSource = readFileSync(path.join(root, 'test/authz/deployment-evidence-matrix.json'), 'utf8');
const matrix = JSON.parse(manifestSource);
const schema = JSON.parse(readFileSync(path.join(root, 'test/authz/deployment-evidence-matrix.schema.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const workflow = readFileSync(path.join(root, '.github/workflows/access-governance-deployment-evidence.yml'), 'utf8');
const recorder = readFileSync(path.join(root, 'scripts/record-deployment-external-evidence.mjs'), 'utf8');
const guide = readFileSync(path.join(root, 'docs/how-to/collect-access-governance-deployment-evidence.md'), 'utf8');
const context = {
  commit: 'a'.repeat(40),
  sourceState: 'clean',
  manifestHash: createHash('sha256').update(manifestSource).digest('hex'),
};

function laneReceipt(lane) {
  return {
    schemaVersion: 1,
    evidenceKind: 'access-governance-deployment-lane',
    laneId: lane.id,
    environmentClass: lane.environmentClass,
    status: 'passed',
    failureCode: null,
    commit: context.commit,
    sourceState: 'clean',
    manifestHash: context.manifestHash,
    startedAt: '2026-07-29T00:00:00.000Z',
    completedAt: '2026-07-29T00:00:01.000Z',
    durationMs: 1000,
    command: lane.script ? `pnpm run ${lane.script}` : null,
    covers: lane.covers,
    artifacts: lane.artifacts,
    successCriteria: lane.successCriteria,
    containsCredentials: false,
    containsTokens: false,
  };
}

function withResults(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'enterpriseglue-deployment-evidence-'));
  try {
    mkdirSync(path.join(directory, 'lanes'), { recursive: true });
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('validates stable lanes, executable scripts, complete coverage, and the external-only OpenShift gate', () => {
  assert.equal(validateMatrix(matrix, packageJson.scripts, root), matrix);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.lanes.items.additionalProperties, false);
  assert.deepEqual(
    new Set(matrix.lanes.map((lane) => lane.environmentClass)),
    new Set(['local_contract', 'local_emulator', 'local_container', 'external_openshift']),
  );
  assert.ok(matrix.requiredCoverage.includes('openshift.failed_rollout_retention'));
  assert.ok(matrix.requiredCoverage.includes('engine.customer_sidecar_operaton'));
  assert.ok(matrix.requiredCoverage.includes('identity.multiple_provider'));
});

test('rejects missing coverage, missing scripts, duplicate lanes, and a local claim for external evidence', () => {
  const missingCoverage = structuredClone(matrix);
  missingCoverage.requiredCoverage.push('security.uncovered');
  assert.throws(() => validateMatrix(missingCoverage, packageJson.scripts, root), /has no lane/);

  const missingScript = structuredClone(matrix);
  missingScript.lanes[0].script = 'test:not-registered';
  assert.throws(() => validateMatrix(missingScript, packageJson.scripts, root), /missing package script/);

  const duplicate = structuredClone(matrix);
  duplicate.lanes.push(structuredClone(duplicate.lanes[0]));
  assert.throws(() => validateMatrix(duplicate, packageJson.scripts, root), /Duplicate lane id/);

  const localOpenShift = structuredClone(matrix);
  const external = localOpenShift.lanes.find((lane) => lane.id === 'external-openshift-rollout');
  external.environmentClass = 'local_container';
  external.script = 'test:openshift-config-bundles';
  delete external.externalProcedure;
  assert.throws(() => validateMatrix(localOpenShift, packageJson.scripts, root), /failed-rollout retention must remain an external gate/);
});

test('marks absent external evidence pending and never promotes a local-only index to release-qualified', () => {
  withResults((directory) => {
    for (const lane of matrix.lanes.filter((candidate) => candidate.environmentClass !== 'external_openshift')) {
      writeFileSync(path.join(directory, 'lanes', `${lane.id}.json`), JSON.stringify(laneReceipt(lane)));
    }
    const index = buildEvidenceIndex(matrix, directory, context);
    assert.equal(index.gateStatus.pull_request.status, 'passed');
    assert.equal(index.gateStatus.local_release.status, 'passed');
    assert.equal(index.gateStatus.release.status, 'pending');
    assert.equal(index.externalEvidenceComplete, false);
    assert.deepEqual(index.pendingExternalLaneIds, ['external-openshift-rollout']);
    assert.equal(index.releaseCommitQualified, false);
    assert.equal(index.releaseStatus, 'pending-evidence');
  });
});

test('requires same-commit sanitized receipts for every release lane', () => {
  withResults((directory) => {
    for (const lane of matrix.lanes) {
      writeFileSync(path.join(directory, 'lanes', `${lane.id}.json`), JSON.stringify(laneReceipt(lane)));
    }
    const complete = buildEvidenceIndex(matrix, directory, context);
    assert.equal(complete.gateStatus.release.status, 'passed');
    assert.equal(complete.externalEvidenceComplete, true);
    assert.equal(complete.releaseCommitQualified, true);

    const staleLane = matrix.lanes[0];
    writeFileSync(path.join(directory, 'lanes', `${staleLane.id}.json`), JSON.stringify({
      ...laneReceipt(staleLane),
      commit: 'b'.repeat(40),
    }));
    const stale = buildEvidenceIndex(matrix, directory, context);
    assert.equal(stale.gateStatus.release.status, 'failed');
    assert.ok(stale.gateStatus.release.failedLaneIds.includes(staleLane.id));
    assert.equal(stale.releaseCommitQualified, false);
  });
});

test('CI publishes only the bounded evidence directory and keeps emulators, containers, and OpenShift explicit', () => {
  assert.match(workflow, /pnpm run test:deployment-evidence:pr/);
  assert.match(workflow, /pnpm run test:deployment-evidence:emulators/);
  assert.match(workflow, /pnpm run test:deployment-evidence:containers/);
  assert.match(workflow, /environment: access-governance-openshift-evidence/);
  assert.match(workflow, /DEPLOYMENT_EVIDENCE_EXTERNAL_GATE: openshift/);
  assert.match(workflow, /test\/results\/access-governance-deployment/);
  assert.doesNotMatch(workflow, /path:\s+\.artifacts/);
  assert.match(workflow, /releaseCommitQualified/);
});

test('the external recorder accepts only bounded checks and artifact digests from the clean candidate', () => {
  for (const check of [
    'configmap_secret_rendered',
    'new_rollout_failed_closed',
    'previous_replica_set_available',
    'recovery_rollout_succeeded',
    'sanitized_readiness_retained',
  ]) {
    assert.match(recorder, new RegExp(check));
  }
  assert.match(recorder, /DEPLOYMENT_EVIDENCE_EXTERNAL_GATE/);
  assert.match(recorder, /status', '--porcelain', '--untracked-files=no/);
  assert.match(recorder, /containsCredentials: false/);
  assert.match(recorder, /containsTokens: false/);
  assert.match(recorder, /SHA-256 digest/);
  assert.doesNotMatch(recorder, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD|OPENSHIFT_TOKEN)/);
  assert.match(guide, /local run leaves the\s+external OpenShift lane `pending`/);
  assert.match(guide, /Do not automatically delete the prior ReplicaSet/);
});
