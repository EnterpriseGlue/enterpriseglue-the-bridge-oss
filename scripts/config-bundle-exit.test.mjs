import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigBundleExitCode, classifyConfigBundleHttpFailure, reconciliationExitCode, reconciliationWaitState } from './lib/config-bundle-exit.mjs';

test('classifies API failures for CI remediation', () => {
  assert.equal(classifyConfigBundleHttpFailure(401), ConfigBundleExitCode.AUTHORIZATION);
  assert.equal(classifyConfigBundleHttpFailure(403), ConfigBundleExitCode.AUTHORIZATION);
  assert.equal(classifyConfigBundleHttpFailure(409), ConfigBundleExitCode.CONFLICT);
  assert.equal(classifyConfigBundleHttpFailure(422), ConfigBundleExitCode.VALIDATION);
  assert.equal(classifyConfigBundleHttpFailure(503), ConfigBundleExitCode.TRANSPORT);
});

test('fails a completed apply only when reconciliation itself fails', () => {
  assert.equal(reconciliationExitCode({ reconciliation: { identitySnapshot: { status: 'failed' } } }), ConfigBundleExitCode.RECONCILIATION);
  assert.equal(reconciliationExitCode({ reconciliation: { identitySnapshot: { status: 'truncated' } } }), null);
});

test('wait state completes only after every durable task completes', () => {
  assert.equal(reconciliationWaitState([]), 'completed');
  assert.equal(reconciliationWaitState([{ status: 'queued' }]), 'pending');
  assert.equal(reconciliationWaitState([{ status: 'completed' }, { status: 'completed' }]), 'completed');
  assert.equal(reconciliationWaitState([{ status: 'cancelled' }]), 'failed');
});
