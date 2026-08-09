import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateSecuritySeverityGate } from './enforce-security-severity-gate.mjs';

test('passes only when critical and high counts are zero', () => {
  assert.deepEqual(evaluateSecuritySeverityGate({ critical: '0', high: '0' }), {
    blocked: false,
    critical: 0,
    high: 0,
  });
  assert.equal(evaluateSecuritySeverityGate({ critical: '1', high: '0' }).blocked, true);
  assert.equal(evaluateSecuritySeverityGate({ critical: '0', high: '7' }).blocked, true);
});

test('rejects missing, negative, and malformed finding counts', () => {
  assert.throws(
    () => evaluateSecuritySeverityGate({ critical: undefined, high: '0' }),
    /Critical vulnerability count must be a non-negative integer/,
  );
  assert.throws(
    () => evaluateSecuritySeverityGate({ critical: '0', high: '-1' }),
    /High vulnerability count must be a non-negative integer/,
  );
  assert.throws(
    () => evaluateSecuritySeverityGate({ critical: '0', high: '1 high' }),
    /High vulnerability count must be a non-negative integer/,
  );
});

test('CLI returns distinct pass, blocked, and invalid exit codes', () => {
  const script = fileURLToPath(new URL('./enforce-security-severity-gate.mjs', import.meta.url));
  const run = (critical, high) => spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, CRITICAL_FINDINGS: critical, HIGH_FINDINGS: high },
  });

  assert.equal(run('0', '0').status, 0);
  assert.equal(run('0', '1').status, 1);
  assert.equal(run('invalid', '0').status, 2);
});
