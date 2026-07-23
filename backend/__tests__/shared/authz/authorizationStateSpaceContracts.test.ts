import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHZ_ACTIONS,
  AUTHZ_PRINCIPAL_TYPES,
  AUTHZ_RESOURCE_TYPES,
} from '@enterpriseglue/shared/authz/permission-actions.js';
import {
  PermissionCatalog,
  SystemRoleDefinitions,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';

interface EvidenceReference {
  testFile: string;
  testName: string;
}

interface StateSpaceContract {
  schemaVersion: number;
  coverageStandard: string;
  releaseEligible: boolean;
  releaseStatus: string;
  canonicalDimensions: Record<string, string[]>;
  scenarioDimensions: Record<string, string[]>;
  applicabilityRules: Array<{
    id: string;
    condition: string;
    classification: string;
    expected: string;
    witness: EvidenceReference;
  }>;
  executionFamilies: Array<{
    id: string;
    purpose: string;
    testFile: string;
    testName: string;
  }>;
  completedReleaseObligations: string[];
  remainingReleaseObligations: string[];
}

const repoRoot = resolve(import.meta.dirname, '../../../..');
const contractPath = resolve(repoRoot, 'test/authz/authorization-state-space-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as StateSpaceContract;

function expectUniqueNonEmpty(values: string[], label: string): void {
  expect(values.length, `${label} must not be empty`).toBeGreaterThan(0);
  expect(new Set(values).size, `${label} must not contain duplicates`).toBe(values.length);
  for (const value of values) {
    expect(value.trim(), `${label} values must not be blank`).not.toBe('');
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function expectEvidence(reference: EvidenceReference): void {
  const absolutePath = resolve(repoRoot, reference.testFile);
  expect(existsSync(absolutePath), `missing evidence file: ${reference.testFile}`).toBe(true);
  expect(
    readFileSync(absolutePath, 'utf8'),
    `${reference.testFile} does not contain evidence name: ${reference.testName}`,
  ).toContain(reference.testName);
}

describe('authorization state-space foundation', () => {
  it('mirrors every canonical production dimension without a hand-maintained count', () => {
    expect(contract.schemaVersion).toBe(1);
    expect(contract.coverageStandard).toBe('constraint-derived-authorization-state-space');

    const canonical = contract.canonicalDimensions;
    expect(sorted(canonical.principalTypes)).toEqual(sorted(AUTHZ_PRINCIPAL_TYPES));
    expect(sorted(canonical.resourceTypes)).toEqual(sorted(AUTHZ_RESOURCE_TYPES));
    expect(sorted(canonical.permissionScopes)).toEqual(sorted(new Set(
      PermissionCatalog.map((permission) => permission.scope),
    )));
    expect(sorted(canonical.roleScopes)).toEqual(sorted(new Set(
      SystemRoleDefinitions.map((role) => role.scope),
    )));
    expect(sorted(canonical.actionOperations)).toEqual(sorted(new Set(
      AUTHZ_ACTIONS.map((action) => action.operation),
    )));
    expect(sorted(canonical.actionRisks)).toEqual(sorted(new Set(
      AUTHZ_ACTIONS.map((action) => action.risk),
    )));

    const permissionIds = new Set(PermissionCatalog.map((permission) => permission.key));
    expect(permissionIds.size).toBe(PermissionCatalog.length);
    expect(new Set(AUTHZ_ACTIONS.map((action) => action.actionId)).size).toBe(AUTHZ_ACTIONS.length);
    expect(new Set(SystemRoleDefinitions.map((role) => role.key)).size).toBe(SystemRoleDefinitions.length);

    for (const action of AUTHZ_ACTIONS) {
      expect(permissionIds.has(action.permissionId), action.actionId).toBe(true);
      expect(AUTHZ_RESOURCE_TYPES).toContain(action.resourceType);
    }
    for (const role of SystemRoleDefinitions) {
      expectUniqueNonEmpty(role.permissions, `${role.key}.permissions`);
      for (const permission of role.permissions) {
        expect(permissionIds.has(permission), `${role.key}: ${permission}`).toBe(true);
      }
    }
  });

  it('declares every scenario dimension and keeps invalidity rules executable', () => {
    for (const [dimension, values] of Object.entries(contract.scenarioDimensions)) {
      expectUniqueNonEmpty(values, `scenarioDimensions.${dimension}`);
    }

    const requiredDimensions = [
      'topologies',
      'runtimeAccessModes',
      'assignmentScopes',
      'permissionSources',
      'assignmentStates',
      'tenantRelationships',
      'resourceStates',
      'observations',
    ];
    expect(Object.keys(contract.scenarioDimensions).sort()).toEqual(requiredDimensions.sort());

    const ruleIds = contract.applicabilityRules.map((rule) => rule.id);
    expectUniqueNonEmpty(ruleIds, 'applicabilityRules');
    for (const rule of contract.applicabilityRules) {
      expect(rule.id).toMatch(/^AUTHZ-INVALID-\d{3}$/);
      expect(rule.condition.trim()).not.toBe('');
      expect(rule.classification).toBe('invalid');
      expect(rule.expected.trim()).not.toBe('');
      expectEvidence(rule.witness);
    }
  });

  it('anchors current execution families while refusing a premature release claim', () => {
    const familyIds = contract.executionFamilies.map((family) => family.id);
    expectUniqueNonEmpty(familyIds, 'executionFamilies');
    for (const family of contract.executionFamilies) {
      expect(family.id).toMatch(/^AUTHZ-EXEC-\d{3}$/);
      expect(family.purpose.trim()).not.toBe('');
      expectEvidence(family);
    }

    expect(contract.releaseEligible).toBe(false);
    expect(contract.releaseStatus).toBe('foundation-only');
    expect(contract.completedReleaseObligations).toContain(
      'generate a witness for every invalidity class',
    );
    expect(contract.remainingReleaseObligations).toEqual(expect.arrayContaining([
      'generate every applicable behavior cell',
      'execute every generated cell at its declared layer',
      'prove equivalence expansion for compressed independent permission combinations',
      'retain same-clean-commit authorization-matrix.json with all zero-gap counters',
    ]));
  });
});
