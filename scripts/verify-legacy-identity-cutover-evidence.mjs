#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MAX_ARTIFACT_BYTES = 512 * 1024;
const FILES = {
  coverageBefore: 'legacy-mapping-coverage-before.json',
  readinessBefore: 'legacy-mapping-retirement-readiness-before.json',
  providerReadiness: 'provider-migration-readiness-before.json',
  statuses: 'verified-mappings-status.txt',
  coverageAfter: 'legacy-mapping-coverage-after-verification.json',
  readinessAfter: 'legacy-mapping-retirement-readiness-after-verification.json',
  cutover: 'legacy-provider-cutover-result.json',
};
const SENSITIVE_MATERIAL = /(?:authorization\s*[:=]|bearer\s+[a-z0-9._-]+|client[_-]?secret\s*[:=]|(?:password|token)\s*[:=]|-----begin(?: [a-z]+)? private key-----|\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.)/i;
const FAMILIES = new Set(['platform_role', 'group', 'engine_assignment']);

export class EvidenceValidationError extends Error {
  constructor(message) { super(message); this.name = 'EvidenceValidationError'; }
}
const fail = (message) => { throw new EvidenceValidationError(message); };
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function readArtifact(directory, filename, { json = true } = {}) {
  const path = resolve(directory, filename);
  let stat;
  try { stat = statSync(path); } catch { fail(`${filename} is required`); }
  if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) fail(`${filename} must be a regular sanitized artifact smaller than ${MAX_ARTIFACT_BYTES} bytes`);
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { fail(`${filename} could not be read`); }
  if (SENSITIVE_MATERIAL.test(text)) fail(`${filename} appears to contain secret or credential material`);
  if (!json) return text;
  try { return JSON.parse(text); } catch { fail(`${filename} must contain valid JSON`); }
}

function requireBoolean(value, filename, field) {
  if (typeof value !== 'boolean') fail(`${filename} must contain boolean ${field}`);
  return value;
}
function requireNonNegativeInteger(value, filename, field) {
  if (!Number.isInteger(value) || value < 0) fail(`${filename} must contain non-negative integer ${field}`);
  return value;
}
function requireString(value, filename, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${filename} must contain non-empty ${field}`);
  return value;
}

function validateCoverage(value, filename, requireVerifications) {
  if (!Array.isArray(value)) fail(`${filename} must contain an array`);
  const seen = new Set();
  return value.map((item) => {
    if (!isRecord(item)) fail(`${filename} contains an invalid coverage item`);
    const id = requireString(item.id, filename, 'coverage item id');
    if (seen.has(id)) fail(`${filename} contains duplicate coverage item ids`);
    seen.add(id);
    if (!FAMILIES.has(item.family)) fail(`${filename} contains an unsupported mapping family`);
    if (item.status !== 'replacement_candidate') fail(`${filename} contains a mapping without a safe replacement candidate`);
    if (!Array.isArray(item.candidateIdentityMappingIds) || item.candidateIdentityMappingIds.length === 0 || item.candidateIdentityMappingIds.some((candidate) => typeof candidate !== 'string' || !candidate.trim())) fail(`${filename} contains a candidate mapping list that is empty or invalid`);
    const candidates = [...new Set(item.candidateIdentityMappingIds)].sort();
    if (candidates.length !== item.candidateIdentityMappingIds.length) fail(`${filename} contains duplicate candidate mapping ids`);
    if (requireVerifications) {
      if (!isRecord(item.verification)) fail(`${filename} contains a mapping without recorded replacement verification`);
      if (!candidates.includes(requireString(item.verification.candidateIdentityMappingId, filename, 'verified candidate identity mapping id'))) fail(`${filename} contains a verification that no longer matches a candidate`);
      requireNonNegativeInteger(item.verification.verifiedAt, filename, 'verification timestamp');
      requireString(item.verification.note, filename, 'verification note');
    }
    return { id, family: item.family, candidates };
  });
}

function validateReadiness(value, filename, coverageCount, requireReady) {
  if (!isRecord(value)) fail(`${filename} must contain an object`);
  const ready = requireBoolean(value.ready, filename, 'ready');
  const activeCount = requireNonNegativeInteger(value.activeLegacyMappingCount, filename, 'activeLegacyMappingCount');
  const verifiedCount = requireNonNegativeInteger(value.verifiedReplacementCount, filename, 'verifiedReplacementCount');
  if (!Array.isArray(value.blockers)) fail(`${filename} must contain a blockers array`);
  if (activeCount !== coverageCount) fail(`${filename} does not match its coverage artifact`);
  if (requireReady && (!ready || value.blockers.length > 0 || verifiedCount !== activeCount)) fail(`${filename} does not show a clear retirement gate`);
}

function validateProviderReadiness(value) {
  const filename = FILES.providerReadiness;
  if (!isRecord(value) || !isRecord(value.checks)) fail(`${filename} must contain readiness checks`);
  if (!requireBoolean(value.ready, filename, 'ready') || !Array.isArray(value.blockers) || value.blockers.length > 0) fail(`${filename} does not show a clear provider cutover gate`);
  const targetProviderKey = requireString(value.targetProviderKey, filename, 'targetProviderKey');
  const legacyProviderId = requireString(value.legacyProviderId, filename, 'legacyProviderId');
  for (const field of ['targetExists', 'directLoginProtocol', 'enabled', 'secretReferenceConfigured', 'secretReferenceAvailable', 'activeMappingsConfigured']) {
    if (value.checks[field] !== true) fail(`${filename} has an incomplete ${field} check`);
  }
  return { targetProviderKey, legacyProviderId };
}

function validateStatuses(text, coverageCount) {
  const statuses = text.trim() ? text.trim().split(/\r?\n/) : [];
  if (statuses.some((status) => status !== '204')) fail(`${FILES.statuses} may contain only 204 status lines`);
  if (statuses.length !== coverageCount) fail(`${FILES.statuses} must contain one 204 status for every covered mapping`);
}

function sameCoverage(before, after) {
  if (before.length !== after.length) return false;
  const afterById = new Map(after.map((item) => [item.id, item]));
  return before.every((item) => {
    const candidate = afterById.get(item.id);
    return candidate && candidate.family === item.family && candidate.candidates.join('\u0000') === item.candidates.join('\u0000');
  });
}

function validateCutover(value, readiness) {
  const filename = FILES.cutover;
  if (!isRecord(value) || !isRecord(value.legacyProvider)) fail(`${filename} must contain a cutover response`);
  if (requireString(value.legacyProvider.id, filename, 'legacy provider id') !== readiness.legacyProviderId) fail(`${filename} does not match the reviewed legacy provider`);
  if (requireString(value.targetProviderKey, filename, 'targetProviderKey') !== readiness.targetProviderKey) fail(`${filename} does not match the reviewed target provider`);
  if (!requireBoolean(value.legacyProviderDisabled, filename, 'legacyProviderDisabled') && !requireBoolean(value.alreadyDisabled, filename, 'alreadyDisabled')) fail(`${filename} does not confirm that the legacy provider is disabled`);
}

/** Verifies a sanitized evidence directory without printing its contents. */
export function verifyLegacyIdentityCutoverEvidence(directory, { stage = 'pre-retirement' } = {}) {
  if (!['pre-retirement', 'post-cutover'].includes(stage)) fail('stage must be pre-retirement or post-cutover');
  if (typeof directory !== 'string' || !directory.trim()) fail('an evidence directory is required');
  const coverageBefore = validateCoverage(readArtifact(directory, FILES.coverageBefore), FILES.coverageBefore, false);
  validateReadiness(readArtifact(directory, FILES.readinessBefore), FILES.readinessBefore, coverageBefore.length, false);
  const providerReadiness = validateProviderReadiness(readArtifact(directory, FILES.providerReadiness));
  validateStatuses(readArtifact(directory, FILES.statuses, { json: false }), coverageBefore.length);
  const coverageAfter = validateCoverage(readArtifact(directory, FILES.coverageAfter), FILES.coverageAfter, true);
  if (!sameCoverage(coverageBefore, coverageAfter)) fail(`${FILES.coverageAfter} does not match the reviewed baseline coverage`);
  validateReadiness(readArtifact(directory, FILES.readinessAfter), FILES.readinessAfter, coverageAfter.length, true);
  if (stage === 'post-cutover') validateCutover(readArtifact(directory, FILES.cutover), providerReadiness);
  return { stage, coveredMappingCount: coverageAfter.length, providerCutoverValidated: stage === 'post-cutover' };
}

function usage() { return 'Usage: node scripts/verify-legacy-identity-cutover-evidence.mjs --evidence-dir <sanitized-directory> [--stage pre-retirement|post-cutover]'; }
function parseArguments(args) {
  let directory; let stage = 'pre-retirement';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--evidence-dir') directory = args[++index];
    else if (args[index] === '--stage') stage = args[++index];
    else fail(usage());
  }
  if (!directory) fail(usage());
  return { directory, stage };
}
function main() {
  try {
    const { directory, stage } = parseArguments(process.argv.slice(2));
    const result = verifyLegacyIdentityCutoverEvidence(directory, { stage });
    process.stdout.write(`Legacy cutover evidence verified: ${result.coveredMappingCount} covered mapping(s); stage=${result.stage}.\n`);
  } catch (error) {
    process.stderr.write(`Legacy cutover evidence verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
