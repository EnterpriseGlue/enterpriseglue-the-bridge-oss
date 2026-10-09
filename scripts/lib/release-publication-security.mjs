import assert from 'node:assert/strict'
import { hashBytes } from './release-publication-record.mjs'

export const PUBLICATION_SCANNER = 'aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f'
export const SECURITY_ROLES = ['backend', 'frontend', 'managedShardBootstrap', 'pluginInstaller', 'pluginManager']

export function validateSecurityProof(proof, candidate, { now = new Date() } = {}) {
  assert.equal(proof.schemaVersion, 'enterpriseglue-release-publication-security/v1')
  assert.equal(proof.status, 'passed')
  assert.equal(proof.sourceRef, candidate.sourceRevision)
  assert.equal(proof.scanner, PUBLICATION_SCANNER)
  assert.match(proof.ignorePolicySha256, /^[a-f0-9]{64}$/)
  assert.ok(new Date(proof.database.UpdatedAt) <= now && new Date(proof.database.NextUpdate) > now, 'Security database evidence is not current.')
  const expected = SECURITY_ROLES.flatMap(role => ['amd64', 'arm64'].map(architecture => `${role}:linux/${architecture}:${candidate.subjects[role].subject}`)).sort()
  assert.deepEqual(proof.reports.map(report => `${report.role}:${report.platform}:${report.subject}`).sort(), expected,
    'Fresh security proof must cover all five exact images on both architectures.')
  for (const report of proof.reports) assert.match(report.sha256, /^[a-f0-9]{64}$/)
  return proof
}

export function createSecurityProof({ candidate, database, ignorePolicy, reports, now = new Date() }) {
  const recorded = []
  for (const role of SECURITY_ROLES) for (const architecture of ['amd64', 'arm64']) {
    const bytes = reports[`${role}-${architecture}`]
    assert.ok(bytes, `Missing security report ${role}-${architecture}.`)
    const report = JSON.parse(bytes)
    assert.equal(report.ArtifactName, candidate.subjects[role].subject)
    assert.equal(report.Metadata.ImageConfig.architecture, architecture)
    assert.equal(report.Metadata.ImageConfig.os, 'linux')
    assert.ok((report.Results || []).every(result => !(result.Vulnerabilities || []).length), 'Unignored vulnerabilities block publication.')
    recorded.push({role, platform: `linux/${architecture}`, subject: report.ArtifactName, sha256: hashBytes(bytes)})
  }
  return validateSecurityProof({schemaVersion: 'enterpriseglue-release-publication-security/v1',status:'passed',
    sourceRef:candidate.sourceRevision,scanner:PUBLICATION_SCANNER,database,ignorePolicySha256:hashBytes(ignorePolicy),
    scannedAt:now.toISOString(),reports:recorded}, candidate, {now})
}
