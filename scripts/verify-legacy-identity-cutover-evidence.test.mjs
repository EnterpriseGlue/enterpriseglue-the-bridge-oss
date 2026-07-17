import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceValidationError, verifyLegacyIdentityCutoverEvidence } from './verify-legacy-identity-cutover-evidence.mjs';

const artifact = (directory, filename, value) => writeFileSync(join(directory, filename), typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, 'utf8');
const coverage = (verification = null) => [{ id: 'legacy-mapping-1', family: 'engine_assignment', status: 'replacement_candidate', reason: 'A matching provider-neutral mapping is active.', candidateIdentityMappingIds: ['replacement-mapping-1'], verification }];
const readiness = (ready, verifiedReplacementCount) => ({ ready, activeLegacyMappingCount: 1, verifiedReplacementCount, blockers: ready ? [] : [{ id: 'legacy-mapping-1', family: 'engine_assignment', reason: 'Not yet verified.' }] });
const providerReadiness = { ready: true, targetProviderKey: 'replacement-oidc', legacyProviderId: 'legacy-provider-1', requiredDefaultGroupId: null, activeMappingCount: 1, checks: { targetExists: true, directOidc: true, directLoginProtocol: true, enabled: true, secretReferenceConfigured: true, secretReferenceAvailable: true, activeMappingsConfigured: true, defaultRoleMappingConfigured: null }, blockers: [] };

function createEvidenceDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'enterpriseglue-cutover-evidence-'));
  artifact(directory, 'legacy-mapping-coverage-before.json', coverage());
  artifact(directory, 'legacy-mapping-retirement-readiness-before.json', readiness(false, 0));
  artifact(directory, 'provider-migration-readiness-before.json', providerReadiness);
  artifact(directory, 'verified-mappings-status.txt', '204\n');
  artifact(directory, 'legacy-mapping-coverage-after-verification.json', coverage({ candidateIdentityMappingId: 'replacement-mapping-1', verifiedById: null, verifiedAt: 1, note: 'CHG-1234: evidence retained in the approved change record.' }));
  artifact(directory, 'legacy-mapping-retirement-readiness-after-verification.json', readiness(true, 1));
  return directory;
}

test('validates a complete sanitized pre-retirement evidence bundle', () => {
  const directory = createEvidenceDirectory();
  try { assert.deepEqual(verifyLegacyIdentityCutoverEvidence(directory), { stage: 'pre-retirement', coveredMappingCount: 1, providerCutoverValidated: false }); } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('requires a matching 204 status for every covered mapping', () => {
  const directory = createEvidenceDirectory();
  try { artifact(directory, 'verified-mappings-status.txt', '204\n204\n'); assert.throws(() => verifyLegacyIdentityCutoverEvidence(directory), EvidenceValidationError); } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('accepts an empty status file when there are no active legacy mappings', () => {
  const directory = createEvidenceDirectory();
  try {
    artifact(directory, 'legacy-mapping-coverage-before.json', []);
    artifact(directory, 'legacy-mapping-retirement-readiness-before.json', { ready: true, activeLegacyMappingCount: 0, verifiedReplacementCount: 0, blockers: [] });
    artifact(directory, 'verified-mappings-status.txt', '');
    artifact(directory, 'legacy-mapping-coverage-after-verification.json', []);
    artifact(directory, 'legacy-mapping-retirement-readiness-after-verification.json', { ready: true, activeLegacyMappingCount: 0, verifiedReplacementCount: 0, blockers: [] });
    assert.deepEqual(verifyLegacyIdentityCutoverEvidence(directory), { stage: 'pre-retirement', coveredMappingCount: 0, providerCutoverValidated: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('rejects credential material without echoing it', () => {
  const directory = createEvidenceDirectory(); const secret = 'Bearer intentionally-not-a-real-token';
  try { artifact(directory, 'legacy-mapping-coverage-before.json', `${secret}\n`); assert.throws(() => verifyLegacyIdentityCutoverEvidence(directory), (error) => error instanceof EvidenceValidationError && !error.message.includes(secret)); } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('validates deployed provider cutover only when it matches reviewed readiness', () => {
  const directory = createEvidenceDirectory();
  try {
    artifact(directory, 'legacy-provider-cutover-result.json', { legacyProvider: { id: 'legacy-provider-1', name: 'legacy', type: 'oidc' }, targetProviderKey: 'replacement-oidc', legacyProviderDisabled: true, alreadyDisabled: false });
    assert.deepEqual(verifyLegacyIdentityCutoverEvidence(directory, { stage: 'post-cutover' }), { stage: 'post-cutover', coveredMappingCount: 1, providerCutoverValidated: true });
    artifact(directory, 'legacy-provider-cutover-result.json', { legacyProvider: { id: 'legacy-provider-1' }, targetProviderKey: 'wrong-target', legacyProviderDisabled: true, alreadyDisabled: false });
    assert.throws(() => verifyLegacyIdentityCutoverEvidence(directory, { stage: 'post-cutover' }), EvidenceValidationError);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
