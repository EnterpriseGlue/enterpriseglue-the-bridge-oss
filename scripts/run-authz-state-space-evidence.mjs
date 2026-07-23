#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDirectory = path.join(root, 'test/results/engine-tenancy-release');
const outputPath = path.join(outputDirectory, 'authorization-matrix.json');
const contractPath = path.join(root, 'test/authz/authorization-state-space-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
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
  delete process.env[key];
}
safeEnvironment.EG_ENV_FILE = path.join(root, 'scripts/local-safe-test.env');
process.env.EG_ENV_FILE = safeEnvironment.EG_ENV_FILE;

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function runLane(lane) {
  console.log(`[authz-state-space] running ${lane.id}`);
  const result = spawnSync(lane.command, lane.args, {
    cwd: root,
    env: safeEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${lane.id} failed; authorization evidence was not retained`);
  }
  return {
    id: lane.id,
    layer: lane.layer,
    status: 'passed',
    command: [lane.command, ...lane.args].join(' '),
  };
}

function product(values) {
  return values.reduce((total, value) => total * BigInt(value), 1n);
}

const startCommit = command('git', ['rev-parse', 'HEAD']);
const startChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startChanges && !allowDirty) {
  throw new Error('Authorization state-space evidence must be run from a clean worktree');
}

const lanes = [
  {
    id: 'shared-registry-build',
    layer: 'build',
    command: 'pnpm',
    args: ['--filter', './packages/shared', 'run', 'build'],
  },
  {
    id: 'canonical-registry-and-invalidity-contracts',
    layer: 'unit',
    command: 'pnpm',
    args: ['run', 'test:authz:state-space-foundation'],
  },
  {
    id: 'generated-action-permission-and-role-contracts',
    layer: 'unit',
    command: 'pnpm',
    args: [
      '--dir',
      'backend',
      'exec',
      'vitest',
      'run',
      '__tests__/shared/authz/exhaustiveActionCoverageContracts.test.ts',
      '__tests__/shared/authz/generatedActionRouteContracts.test.ts',
      '__tests__/shared/authz/permissionActionRegistry.test.ts',
      '__tests__/shared/authz/route-inventory.test.ts',
      '__tests__/shared/authz/tenantRolePolicy.test.ts',
      '__tests__/shared/services/platform-admin/tenantRoleInheritance.test.ts',
      '--config',
      'vitest.config.ts',
      '--maxWorkers=1',
      '--no-file-parallelism',
      '--reporter=dot',
    ],
  },
  {
    id: 'backend-invalidity-witnesses',
    layer: 'unit-and-service',
    command: 'pnpm',
    args: [
      '--dir',
      'backend',
      'exec',
      'vitest',
      'run',
      '__tests__/shared/engine-tenancy/classificationPolicy.test.ts',
      '__tests__/shared/schemas/mission-control/engine.test.ts',
      '__tests__/shared/services/platform-admin/permissions.test.ts',
      '__tests__/shared/services/platform-admin/runtimeResourceInventoryService.test.ts',
      '__tests__/shared/middleware/requireAction.test.ts',
      '__tests__/shared/services/platform-admin/engineTenantMappingService.test.ts',
      '--config',
      'vitest.config.ts',
      '--maxWorkers=1',
      '--no-file-parallelism',
      '--reporter=dot',
    ],
  },
  {
    id: 'database-scope-principal-and-model-contracts',
    layer: 'postgresql',
    command: './scripts/run-local-safe-custom-role-matrix.sh',
    args: [],
  },
  {
    id: 'browser-revocation-invalidity-witness',
    layer: 'browser',
    command: 'pnpm',
    args: ['run', 'test:authz:local-smoke:cross-browser'],
  },
];
const laneResults = lanes.map(runLane);

const {
  AUTHZ_ACTIONS,
  AUTHZ_PRINCIPAL_TYPES,
  AUTHZ_RESOURCE_TYPES,
} = await import('../packages/shared/dist/authz/permission-actions.js');
const {
  PermissionCatalog,
  SystemRoleDefinitions,
} = await import('../packages/shared/dist/services/platform-admin/permissions.js');

const canonicalInputs = {
  principalTypes: [...AUTHZ_PRINCIPAL_TYPES].sort(),
  resourceTypes: [...AUTHZ_RESOURCE_TYPES].sort(),
  permissionIds: PermissionCatalog.map((permission) => permission.key).sort(),
  roleIds: SystemRoleDefinitions.map((role) => role.key).sort(),
  actionIds: AUTHZ_ACTIONS.map((action) => action.actionId).sort(),
  canonicalDimensions: Object.fromEntries(
    Object.entries(contract.canonicalDimensions)
      .map(([key, values]) => [key, [...values].sort()])
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
  scenarioDimensions: Object.fromEntries(
    Object.entries(contract.scenarioDimensions)
      .map(([key, values]) => [key, [...values].sort()])
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
  invalidityRuleIds: contract.applicabilityRules.map((rule) => rule.id).sort(),
};
const canonicalInputSource = JSON.stringify(canonicalInputs);
const canonicalInputHash = createHash('sha256').update(canonicalInputSource).digest('hex');
const canonicalValueCount = [
  canonicalInputs.principalTypes,
  canonicalInputs.resourceTypes,
  canonicalInputs.permissionIds,
  canonicalInputs.roleIds,
  canonicalInputs.actionIds,
  ...Object.values(contract.canonicalDimensions),
  ...Object.values(contract.scenarioDimensions),
].reduce((total, values) => total + values.length, 0);
const scenarioCounts = Object.values(contract.scenarioDimensions).map((values) => values.length);
const rawTupleCount = product([
  AUTHZ_ACTIONS.length,
  AUTHZ_PRINCIPAL_TYPES.length,
  ...scenarioCounts,
]);
if (rawTupleCount > BigInt(Number.MAX_SAFE_INTEGER)) {
  throw new Error('Authorization raw tuple count exceeds the safe JSON integer range');
}

const structuralCellCount =
  AUTHZ_ACTIONS.length +
  PermissionCatalog.length +
  SystemRoleDefinitions.length;
const missingBehaviorClasses = contract.remainingReleaseObligations.map((obligation, index) => ({
  id: `AUTHZ-GAP-${String(index + 1).padStart(3, '0')}`,
  obligation,
}));
const endCommit = command('git', ['rev-parse', 'HEAD']);
const endChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
if (startCommit !== endCommit || (!allowDirty && endChanges)) {
  throw new Error('Source changed while authorization state-space evidence was running');
}

const sourceState = endChanges ? 'dirty-development-run' : 'clean';
const evidence = {
  schemaVersion: 1,
  evidenceKind: 'authorization-state-space',
  coverageStandard: contract.coverageStandard,
  status: 'incomplete',
  releaseStatus: 'executed-foundation-only',
  generatedAt: new Date().toISOString(),
  commit: endCommit,
  sourceState,
  releaseCommitQualified: false,
  canonicalInputHash,
  deterministicSeed: 'authorization-state-space-v1',
  shard: { index: 1, total: 1 },
  canonicalValueCount,
  classifiedCanonicalValueCount: canonicalValueCount,
  rawTupleCount: Number(rawTupleCount),
  applicableCellCount: structuralCellCount + missingBehaviorClasses.length,
  executedApplicableCellCount: structuralCellCount,
  equivalenceExpandedCellCount: 0,
  invalidityClassCount: contract.applicabilityRules.length,
  executedInvalidityWitnessCount: contract.applicabilityRules.length,
  missingCells: missingBehaviorClasses.length,
  skippedCells: 0,
  quarantinedCells: 0,
  unknownCells: 0,
  unexpectedCells: 0,
  canonicalCounts: {
    principals: AUTHZ_PRINCIPAL_TYPES.length,
    resources: AUTHZ_RESOURCE_TYPES.length,
    permissions: PermissionCatalog.length,
    roles: SystemRoleDefinitions.length,
    actions: AUTHZ_ACTIONS.length,
  },
  coverage: {
    canonicalDimensions: Object.fromEntries(
      Object.entries(contract.canonicalDimensions).map(([key, values]) => [
        key,
        { covered: values.length, total: values.length },
      ]),
    ),
    scenarioDimensions: Object.fromEntries(
      Object.entries(contract.scenarioDimensions).map(([key, values]) => [
        key,
        { classified: values.length, total: values.length, behaviorExecution: 'pending' },
      ]),
    ),
    actions: { structuralContracts: AUTHZ_ACTIONS.length, total: AUTHZ_ACTIONS.length },
    permissions: { policyContracts: PermissionCatalog.length, total: PermissionCatalog.length },
    roles: { structuralContracts: SystemRoleDefinitions.length, total: SystemRoleDefinitions.length },
    invalidityRules: contract.applicabilityRules.map((rule) => ({
      id: rule.id,
      status: 'witness-passed',
      witness: rule.witness,
    })),
  },
  lanes: laneResults,
  missingBehaviorClasses,
  rule:
    'This artifact is deliberately incomplete until every supported behavior cell is executed and every equivalence expansion is proved. Registry and witness success alone cannot pass the release gate.',
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  `[authz-state-space] ${evidence.executedApplicableCellCount}/${evidence.applicableCellCount} ` +
  `current cells; ${evidence.missingCells} behavior classes remain: ${path.relative(root, outputPath)}`,
);
