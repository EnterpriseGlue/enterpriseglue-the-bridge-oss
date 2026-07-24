import { createHash } from 'node:crypto';

const RUNTIME_SCOPES = new Set([
  'engine_runtime_resource',
  'engine_runtime_resource_set',
]);
const RUNTIME_MAPPING_ONLY_STATES = new Set([
  'unmapped',
  'multiply_mapped',
  'stale_mapping',
  'quarantined',
]);
const ABSENT_RESOURCE_STATES = new Set([
  'deleted',
  'recreated_new_id',
]);
const MACHINE_PRINCIPALS = new Set([
  'api_client',
  'service_account',
]);

function product(values) {
  return values.reduce((total, value) => total * BigInt(value), 1n);
}

function counter(values) {
  return Object.fromEntries(values.map((value) => [
    value,
    { classified: 0, supported: 0, invalid: 0 },
  ]));
}

function increment(entry, classification) {
  entry.classified += 1;
  entry[classification] += 1;
}

function stableCellLine(cell, classification, expected, executionFamilyId) {
  return [
    cell.principalType,
    cell.assignmentScope,
    cell.permissionSource,
    cell.assignmentState,
    cell.tenantRelationship,
    cell.resourceState,
    cell.topology,
    cell.runtimeAccessMode,
    classification.ruleId || 'supported',
    expected?.decision || 'invalid',
    executionFamilyId || 'invalidity-witness',
  ].join('|');
}

function classifyApplicability(cell) {
  if (
    RUNTIME_SCOPES.has(cell.assignmentScope)
    && cell.topology === 'dedicated'
    && cell.runtimeAccessMode === 'engine_wide'
  ) {
    return {
      classification: 'invalid',
      ruleId: 'AUTHZ-INVALID-012',
      reason: 'Runtime-specific assignments require resource-aware runtime access.',
    };
  }

  if (
    !RUNTIME_SCOPES.has(cell.assignmentScope)
    && RUNTIME_MAPPING_ONLY_STATES.has(cell.resourceState)
  ) {
    return {
      classification: 'invalid',
      ruleId: 'AUTHZ-INVALID-011',
      reason: 'Mapping-only runtime states do not apply to non-runtime assignment scopes.',
    };
  }

  return {
    classification: 'supported',
    ruleId: null,
    reason: null,
  };
}

/**
 * Independent authorization expectation model.
 *
 * This intentionally does not import or call the production evaluator. The
 * execution registry maps each compressed cell to a production-facing unit,
 * PostgreSQL, HTTP, or browser family that proves the corresponding invariant.
 */
export function independentAuthorizationExpectation(cell, contract) {
  const model = contract.behaviorModel;
  const assignmentActive = model.grantBearingAssignmentStates.includes(cell.assignmentState);
  const tenantAllowed = model.allowedTenantRelationships[cell.topology]
    .includes(cell.tenantRelationship);
  const resourceAllowed = cell.resourceState === model.presentResourceState;
  const allowed = assignmentActive && tenantAllowed && resourceAllowed;

  return {
    decision: allowed ? 'allow' : 'deny',
    filteredResult: allowed ? 'included' : 'excluded',
    effectiveAccess: allowed ? 'source_present' : 'no_active_source',
    audit: 'decision_observed',
    upstreamTransport: allowed ? 'eligible' : 'blocked_before_transport',
  };
}

function executionFamilyFor(cell) {
  if (cell.assignmentState === 'stale_cached') return 'AUTHZ-EXEC-009';
  if (ABSENT_RESOURCE_STATES.has(cell.resourceState)) return 'AUTHZ-EXEC-010';
  if (
    RUNTIME_SCOPES.has(cell.assignmentScope)
    && cell.resourceState !== 'mapped'
  ) {
    return 'AUTHZ-EXEC-008';
  }
  if (MACHINE_PRINCIPALS.has(cell.principalType)) return 'AUTHZ-EXEC-005';
  if (
    cell.permissionSource === 'custom_role'
    || cell.permissionSource === 'group_assignment'
    || cell.principalType === 'group'
    || cell.assignmentScope === 'engine_set'
    || RUNTIME_SCOPES.has(cell.assignmentScope)
  ) {
    return 'AUTHZ-EXEC-004';
  }
  if (!['active', 'future'].includes(cell.assignmentState)) return 'AUTHZ-EXEC-007';
  if (!['same_tenant', 'missing_context'].includes(cell.tenantRelationship)) {
    return 'AUTHZ-EXEC-003';
  }
  return 'AUTHZ-EXEC-006';
}

/**
 * Classify the complete compressed behavior tensor and return only aggregate,
 * deterministic evidence. The artifact does not retain individual identities
 * or the 52M expanded tuples.
 */
export function generateAuthorizationBehaviorSummary(contract, {
  actionCount,
} = {}) {
  const dimensions = contract.scenarioDimensions;
  const validPairs = contract.behaviorModel.validTopologyRuntimePairs;
  const rawTupleCount = product([
    actionCount,
    contract.canonicalDimensions.principalTypes.length,
    ...Object.values(dimensions).map((values) => values.length),
  ]);
  if (rawTupleCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Authorization raw tuple count exceeds the safe JSON integer range');
  }

  const coverage = {
    principalTypes: counter(contract.canonicalDimensions.principalTypes),
    assignmentScopes: counter(dimensions.assignmentScopes),
    permissionSources: counter(dimensions.permissionSources),
    assignmentStates: counter(dimensions.assignmentStates),
    tenantRelationships: counter(dimensions.tenantRelationships),
    resourceStates: counter(dimensions.resourceStates),
    topologies: counter(dimensions.topologies),
    runtimeAccessModes: counter(dimensions.runtimeAccessModes),
    observations: Object.fromEntries(dimensions.observations.map((value) => [
      value,
      { covered: 0, total: 0 },
    ])),
  };
  const applicabilityRuleCounts = Object.fromEntries(
    contract.applicabilityRules.map((rule) => [rule.id, 0]),
  );
  const executionFamilyCounts = Object.fromEntries(
    contract.executionFamilies.map((family) => [family.id, 0]),
  );
  const outcomes = { allow: 0, deny: 0 };
  const hash = createHash('sha256');
  let compressedCellCount = 0;
  let applicableCellCount = 0;
  let invalidCompressedCellCount = 0;

  for (const principalType of contract.canonicalDimensions.principalTypes) {
    for (const assignmentScope of dimensions.assignmentScopes) {
      for (const permissionSource of dimensions.permissionSources) {
        for (const assignmentState of dimensions.assignmentStates) {
          for (const tenantRelationship of dimensions.tenantRelationships) {
            for (const resourceState of dimensions.resourceStates) {
              for (const pair of validPairs) {
                const cell = {
                  principalType,
                  assignmentScope,
                  permissionSource,
                  assignmentState,
                  tenantRelationship,
                  resourceState,
                  topology: pair.topology,
                  runtimeAccessMode: pair.runtimeAccessMode,
                };
                const applicability = classifyApplicability(cell);
                compressedCellCount += 1;

                for (const [dimension, value] of [
                  ['principalTypes', principalType],
                  ['assignmentScopes', assignmentScope],
                  ['permissionSources', permissionSource],
                  ['assignmentStates', assignmentState],
                  ['tenantRelationships', tenantRelationship],
                  ['resourceStates', resourceState],
                  ['topologies', pair.topology],
                  ['runtimeAccessModes', pair.runtimeAccessMode],
                ]) {
                  increment(coverage[dimension][value], applicability.classification);
                }

                if (applicability.classification === 'invalid') {
                  invalidCompressedCellCount += 1;
                  applicabilityRuleCounts[applicability.ruleId] += 1;
                  hash.update(`${stableCellLine(cell, applicability, null, null)}\n`);
                  continue;
                }

                const expected = independentAuthorizationExpectation(cell, contract);
                const executionFamilyId = executionFamilyFor(cell);
                if (!(executionFamilyId in executionFamilyCounts)) {
                  throw new Error(`No execution family is registered for ${executionFamilyId}`);
                }
                executionFamilyCounts[executionFamilyId] += 1;
                outcomes[expected.decision] += 1;
                applicableCellCount += 1;
                for (const observation of dimensions.observations) {
                  coverage.observations[observation].covered += 1;
                  coverage.observations[observation].total += 1;
                }
                hash.update(`${stableCellLine(cell, applicability, expected, executionFamilyId)}\n`);
              }
            }
          }
        }
      }
    }
  }

  const observationCount = dimensions.observations.length;
  const expandedApplicableTupleCount =
    BigInt(applicableCellCount) * BigInt(actionCount) * BigInt(observationCount);
  const equivalenceExpandedCellCount =
    expandedApplicableTupleCount - BigInt(applicableCellCount);
  const invalidExpandedTupleCount = rawTupleCount - expandedApplicableTupleCount;
  for (const rule of contract.applicabilityRules) {
    // Rules 1–10 are canonical invalidity classes with explicit witnesses but
    // are not exclusions in this compressed behavior tensor. Rules 11–12
    // classify mutually exclusive tensor states and therefore have counts.
    if (applicabilityRuleCounts[rule.id] === 0 && ['AUTHZ-INVALID-011', 'AUTHZ-INVALID-012'].includes(rule.id)) {
      throw new Error(`Applicability rule ${rule.id} did not classify a tuple`);
    }
  }

  return {
    rawTupleCount: Number(rawTupleCount),
    compressedCellCount,
    applicableCellCount,
    invalidCompressedCellCount,
    expandedApplicableTupleCount: Number(expandedApplicableTupleCount),
    invalidExpandedTupleCount: Number(invalidExpandedTupleCount),
    equivalenceExpandedCellCount: Number(equivalenceExpandedCellCount),
    behaviorCellHash: hash.digest('hex'),
    coverage,
    outcomes,
    applicabilityRuleCounts,
    executionFamilyCounts,
  };
}
