#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  documentationReviewEvidencePending,
  documentationReviewEvidencePasses,
  isSafeDocumentationReviewEvidencePath,
} from './lib/engine-tenancy-documentation-review.mjs';

const root = process.cwd();
const releaseDirectory = path.join(root, 'test/results/engine-tenancy-release');
const requireComplete = process.argv.includes('--require-complete');

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const commit = command('git', ['rev-parse', 'HEAD']);
const trackedChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
const requiredDatabases = ['postgres', 'mysql', 'mssql', 'oracle', 'spanner'];
const requiredDatabaseStages = [
  'clean_install',
  'upgrade_baselines',
  'interrupted_retry',
  'schema_equivalence',
  'service_behavior',
  'rollback',
  'cleanup',
];
const requiredBrowsers = ['chromium', 'firefox', 'webkit'];
const requiredAccessibilityChecks = [
  'error_announcement',
  'contrast',
  'zoom_200_reflow',
  'reduced_motion',
];

function databaseTargetPasses(value, database) {
  const target = value.results?.[database];
  return typeof target?.databaseVersion === 'string'
    && target.databaseVersion.length > 0
    && typeof target.schemaFingerprint === 'string'
    && target.schemaFingerprint.length > 0
    && requiredDatabaseStages.every((stage) => target.stages?.[stage]?.status === 'passed')
    && Number(target.stages?.upgrade_baselines?.total) > 0
    && target.stages.upgrade_baselines.passed === target.stages.upgrade_baselines.total;
}

function provisioningJourneyPasses(journey) {
  return Number.isInteger(journey?.id)
    && journey.status === 'passed'
    && Number(journey.supportedChannelExecutions) > 0
    && journey.missingChannelResults === 0
    && journey.unexpectedChannelResults === 0;
}

function compatibilityStatePasses(value) {
  if (value.warningBehaviorTestsPassed !== true) return false;
  if (value.warningBehavior === 'retained') {
    return value.removalProposed === false;
  }
  if (value.warningBehavior === 'removed') {
    return value.windowClosed === true
      && value.replacementDocumentationPublished === true;
  }
  return false;
}

function nativeGrantSanitizationPasses(value) {
  const fields = [
    'containsCredentials',
    'containsTokens',
    'containsPrivateEndpoints',
    'containsRawIdentityClaims',
    'containsCustomerIdentifiers',
  ];
  return fields.every((field) => value.sanitization?.[field] === false)
    && Object.keys(value.sanitization || {}).length === fields.length;
}

function accessibilityChecksPass(value) {
  const checksByWorkflow = value.verifiedChecks;
  if (!checksByWorkflow || typeof checksByWorkflow !== 'object'
    || Array.isArray(checksByWorkflow)) {
    return false;
  }

  const checkGroups = Object.values(checksByWorkflow);
  if (!checkGroups.every(Array.isArray)) return false;

  return requiredAccessibilityChecks.every((check) =>
    checkGroups.some((checks) => checks.includes(check)));
}

function documentationReviewEvidenceFileExists(value) {
  if (!isSafeDocumentationReviewEvidencePath(value)) return false;
  const absolutePath = path.resolve(root, value);
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

const gateDefinitions = [
  {
    id: 'traceability',
    label: 'Requirement and API traceability',
    path: 'test/results/engine-tenancy-release/requirement-evidence.json',
    passes: (value) => value.status === 'passed'
      && value.manifest?.uncoveredRequirementCount === 0
      && value.manifest?.waiverCount === 0,
    clean: (value) => value.worktreeClean === true,
  },
  {
    id: 'localEnforcement',
    label: 'Local PostgreSQL enforcement',
    path: 'test/results/engine-tenancy-release/local-enforcement.json',
    passes: (value) => value.status === 'passed',
  },
  {
    id: 'mutation',
    label: 'Targeted security mutation',
    path: 'test/results/engine-tenancy-mutation/mutation-report.json',
    passes: (value) => value.status === 'passed'
      && Number(value.total) > 0
      && value.killed === value.total,
  },
  {
    id: 'browserMatrix',
    label: 'Chromium, Firefox, and WebKit',
    path: 'test/results/engine-tenancy-release/browser-matrix.json',
    passes: (value) => value.status === 'passed'
      && value.testCountPerBrowser === 12
      && value.totalPassingExecutions === 36
      && requiredBrowsers
        .every((browser) => value.verifiedTargets?.browsers?.includes(browser)),
  },
  {
    id: 'browserAccessibility',
    label: 'Browser accessibility workflows',
    path: 'test/results/engine-tenancy-release/browser-accessibility.json',
    passes: (value) => value.status === 'passed'
      && Number(value.workflowCount) > 0
      && value.passedWorkflowCount === value.workflowCount
      && value.missingChecks === 0
      && requiredBrowsers
        .every((browser) => value.verifiedTargets?.browsers?.includes(browser))
      && accessibilityChecksPass(value),
  },
  {
    id: 'nativeGrantBrowser',
    label: 'Camunda native-grant authenticated browser workflow',
    path: 'test/results/engine-tenancy-release/camunda-native-grant-browser.json',
    passes: (value) => value.status === 'passed'
      && value.verifiedTargets?.browser === 'chromium'
      && value.verifiedTargets?.database === 'postgres'
      && value.verifiedTargets?.deployment === 'localhost-docker'
      && Array.isArray(value.assertions)
      && value.assertions.length === 6
      && value.assertions.every((assertion) => assertion.status === 'passed')
      && nativeGrantSanitizationPasses(value),
  },
  {
    id: 'authorizationMatrix',
    label: 'Complete supported authorization matrix',
    path: 'test/results/engine-tenancy-release/authorization-matrix.json',
    passes: (value) => value.status === 'passed'
      && value.coverageStandard === 'constraint-derived-authorization-state-space'
      && typeof value.canonicalInputHash === 'string'
      && value.canonicalInputHash.length > 0
      && Number(value.canonicalValueCount) > 0
      && value.classifiedCanonicalValueCount === value.canonicalValueCount
      && Number(value.applicableCellCount) > 0
      && value.executedApplicableCellCount === value.applicableCellCount
      && Number(value.invalidityClassCount) > 0
      && value.executedInvalidityWitnessCount === value.invalidityClassCount
      && value.missingCells === 0
      && value.skippedCells === 0
      && value.quarantinedCells === 0
      && value.unknownCells === 0
      && value.unexpectedCells === 0,
  },
  {
    id: 'databaseMatrix',
    label: 'Five-adapter install, upgrade, retry, service, and rollback matrix',
    path: 'test/results/engine-tenancy-release/database-matrix.json',
    passes: (value) => value.status === 'passed'
      && requiredDatabases
        .every((database) => value.verifiedTargets?.databases?.includes(database))
      && requiredDatabases.every((database) => databaseTargetPasses(value, database)),
  },
  {
    id: 'provisioningJourneys',
    label: 'Fourteen real-service provisioning journeys',
    path: 'test/results/engine-tenancy-release/provisioning-journeys.json',
    passes: (value) => value.status === 'passed'
      && value.passedJourneys === 14
      && value.missingJourneys === 0
      && value.unexpectedChannelResults === 0
      && Array.isArray(value.journeys)
      && value.journeys.length === 14
      && new Set(value.journeys.map((journey) => journey.id)).size === 14
      && value.journeys.every(provisioningJourneyPasses),
  },
  {
    id: 'sourceCoverage',
    label: 'Security-critical 100% source coverage',
    path: 'test/results/engine-tenancy-release/source-coverage.json',
    passes: (value) => value.status === 'passed'
      && ['lines', 'statements', 'branches', 'functions']
        .every((metric) => value.totals?.[metric] === 100),
  },
  {
    id: 'documentationReview',
    label: 'Engineering, security, and independent-operator documentation review',
    path: 'test/results/engine-tenancy-release/documentation-review.json',
    passes: (value) => value.status === 'passed'
      && documentationReviewEvidencePasses(
        value,
        commit,
        documentationReviewEvidenceFileExists,
      ),
  },
  {
    id: 'compatibilityWindow',
    label: 'External omission-warning compatibility',
    path: 'test/results/engine-tenancy-release/compatibility-window.json',
    passes: (value) => value.status === 'passed'
      && compatibilityStatePasses(value),
  },
];

function readGate(definition) {
  const absolutePath = path.join(root, definition.path);
  if (!existsSync(absolutePath)) {
    return {
      id: definition.id,
      label: definition.label,
      status: 'missing',
      artifact: definition.path,
      reason: 'required artifact has not been produced',
    };
  }

  let value;
  try {
    value = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch {
    return {
      id: definition.id,
      label: definition.label,
      status: 'invalid',
      artifact: definition.path,
      reason: 'artifact is not valid JSON',
    };
  }

  const sameCommit = value.commit === commit;
  const clean = definition.clean
    ? definition.clean(value)
    : value.sourceState === 'clean';
  const releaseCommitQualified = definition.clean
    ? clean
    : value.releaseCommitQualified === true;
  const passed = definition.passes(value);
  const pendingApproval = definition.id === 'documentationReview'
    && documentationReviewEvidencePending(
      value,
      commit,
      documentationReviewEvidenceFileExists,
    );
  const status = passed && sameCommit && clean && releaseCommitQualified
    ? 'passed'
    : !sameCommit
      ? 'stale'
      : !clean
        ? 'dirty'
        : pendingApproval
          ? 'pending_approval'
          : 'failed';
  return {
    id: definition.id,
    label: definition.label,
    status,
    artifact: definition.path,
    artifactCommit: value.commit || null,
    sameCommit,
    cleanSourceState: clean,
    releaseCommitQualified,
    reason: status === 'passed'
      ? null
      : status === 'pending_approval'
        ? 'automated checks pass; independent approvals are pending'
        : status === 'stale'
          ? 'artifact was produced for another commit'
          : status === 'dirty'
            ? 'artifact was produced from a dirty worktree'
            : !passed
              ? 'artifact assertions are not fully passing'
              : 'artifact is not release-commit qualified',
  };
}

const gates = gateDefinitions.map(readGate);
const passedGateCount = gates.filter((gate) => gate.status === 'passed').length;
const releaseQualified = trackedChanges.length === 0
  && passedGateCount === gateDefinitions.length;
const evidence = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-release-index',
  generatedAt: new Date().toISOString(),
  commit,
  sourceState: trackedChanges ? 'dirty' : 'clean',
  status: releaseQualified ? 'passed' : 'incomplete',
  releaseQualified,
  passedGateCount,
  requiredGateCount: gateDefinitions.length,
  gates,
  rule: 'A gate passes only when its assertions pass on this exact commit from a clean worktree; declared targets and waivers never count as executed coverage.',
};

mkdirSync(releaseDirectory, { recursive: true });
const jsonPath = path.join(releaseDirectory, 'index.json');
const markdownPath = path.join(releaseDirectory, 'README.md');
writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);

const markdown = [
  '# Engine Tenancy Release Evidence Index',
  '',
  `Commit: \`${commit}\``,
  '',
  `Status: **${releaseQualified ? 'release qualified' : 'incomplete'}** (${passedGateCount}/${gateDefinitions.length} gates)`,
  '',
  '| Gate | Status | Artifact | Reason |',
  '| --- | --- | --- | --- |',
  ...gates.map((gate) =>
    `| ${gate.label} | ${gate.status} | \`${gate.artifact}\` | ${gate.reason || 'Passing on this clean commit'} |`),
  '',
  'A target named in the manifest is not considered tested until its separate',
  'execution artifact passes on the same clean commit. Missing, stale, failed,',
  'dirty, pending-approval, skipped, quarantined, or waived evidence keeps',
  'this index incomplete.',
  '',
].join('\n');
writeFileSync(markdownPath, markdown);

console.log(
  `[engine-tenancy-release-index] ${passedGateCount}/${gateDefinitions.length} gates: ` +
  `${path.relative(root, markdownPath)}`,
);
if (requireComplete && !releaseQualified) {
  process.exitCode = 1;
}
