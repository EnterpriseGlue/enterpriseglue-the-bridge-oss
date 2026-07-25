import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const writer = readFileSync(new URL('./write-engine-tenancy-manifest-evidence.mjs', import.meta.url), 'utf8');
const localWriter = readFileSync(new URL('./write-engine-tenancy-local-evidence.mjs', import.meta.url), 'utf8');
const releaseIndexWriter = readFileSync(new URL('./write-engine-tenancy-release-index.mjs', import.meta.url), 'utf8');
const sourceCoverageRunner = readFileSync(new URL('./run-engine-tenancy-source-coverage.mjs', import.meta.url), 'utf8');
const localRunner = readFileSync(new URL('./run-engine-tenancy-local-evidence.sh', import.meta.url), 'utf8');
const browserWriter = readFileSync(new URL('./write-authz-browser-evidence.mjs', import.meta.url), 'utf8');
const nativeGrantBrowserWriter = readFileSync(new URL('./write-camunda-native-grant-browser-evidence.mjs', import.meta.url), 'utf8');
const nativeGrantBrowserRunner = readFileSync(new URL('./run-camunda-native-grant-browser-evidence.sh', import.meta.url), 'utf8');
const mutationWriter = readFileSync(new URL('./run-authz-mutation-tests.mjs', import.meta.url), 'utf8');
const authorizationMatrixRunner = readFileSync(new URL('./run-authz-state-space-evidence.mjs', import.meta.url), 'utf8');
const authorizationFoundationRunner = readFileSync(new URL('./run-local-safe-authz-state-space-foundation.sh', import.meta.url), 'utf8');
const accessibilityRunner = readFileSync(new URL('./run-authz-accessibility-matrix.sh', import.meta.url), 'utf8');
const accessibilityWriter = readFileSync(new URL('./write-authz-accessibility-evidence.mjs', import.meta.url), 'utf8');
const compatibilityRunner = readFileSync(new URL('./run-engine-tenancy-compatibility-evidence.mjs', import.meta.url), 'utf8');
const documentationReviewRunner = readFileSync(new URL('./run-engine-tenancy-documentation-review-evidence.mjs', import.meta.url), 'utf8');
const documentationReviewRecorder = readFileSync(new URL('./record-engine-tenancy-documentation-review.mjs', import.meta.url), 'utf8');
const documentationReviewContract = readFileSync(new URL('./lib/engine-tenancy-documentation-review.mjs', import.meta.url), 'utf8');
const databaseMatrixRunner = readFileSync(new URL('./run-engine-tenancy-database-matrix.mjs', import.meta.url), 'utf8');
const randomizedAuthorizationModel = readFileSync(
  new URL('../backend/test/integration/authorization-model-randomized.test.ts', import.meta.url),
  'utf8',
);
const databaseMatrixContract = JSON.parse(readFileSync(
  new URL('../test/database/engine-tenancy-database-matrix-contract.json', import.meta.url),
  'utf8',
));
const provisioningEvidenceWriter = readFileSync(new URL('./write-engine-tenancy-provisioning-evidence.mjs', import.meta.url), 'utf8');
const provisioningJourneyRunner = readFileSync(new URL('./run-engine-tenancy-provisioning-journeys.sh', import.meta.url), 'utf8');
const provisioningJourneyRegistry = JSON.parse(readFileSync(
  new URL('../test/authz/engine-tenancy-provisioning-journeys.json', import.meta.url),
  'utf8',
));
const playwrightConfig = readFileSync(new URL('../test/e2e/playwright.config.ts', import.meta.url), 'utf8');

test('writes sanitized commit, schema, target, waiver, and requirement traceability evidence', () => {
  const manifestCommand = packageJson.scripts['test:engine-tenancy:manifest'];
  assert.match(manifestCommand, /engine-tenancy-functional-coverage\.test\.mjs/);
  assert.match(manifestCommand, /engine-tenancy-evidence\.test\.mjs/);
  assert.match(manifestCommand, /write-engine-tenancy-manifest-evidence\.mjs/);

  for (const requiredField of [
    'commit',
    'worktreeClean',
    'nodeVersion',
    'pnpmVersion',
    'databaseSchemaVersion',
    'coverageScope',
    'uncoveredRequirementCount',
    'publicOperationCount',
    'stableErrorCount',
    'supportedTransitionCount',
    'waiverCount',
    'declaredTargets',
    'verifiedTargets',
    'requirements',
  ]) {
    assert.match(writer, new RegExp(`\\b${requiredField}\\b`));
  }
  assert.match(writer, /test\/results\/engine-tenancy-release/);
  assert.match(writer, /traceability-only/);
  assert.match(writer, /not inferred from this manifest/);
  assert.doesNotMatch(writer, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('keeps transient Playwright output separate from retained release evidence', () => {
  assert.match(playwrightConfig, /outputDir: '\.\.\/results\/playwright'/);
  assert.match(browserWriter, /test\/results\/playwright\/\.last-run\.json/);
  assert.ok(
    localRunner.indexOf('write-engine-tenancy-local-evidence.mjs')
      > localRunner.indexOf('test:engine-tenancy:enforcement'),
  );
  assert.match(localWriter, /engine-tenancy-release/);
  assert.match(localWriter, /local-enforcement\.json/);
  assert.match(localWriter, /appliedEngineIds\.length !== 1/);
  assert.match(localWriter, /releaseCommitQualified/);
  assert.match(localRunner, /ENGINE_TENANCY_APPLY_READY=true/);
  assert.doesNotMatch(localWriter, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('builds a fail-closed same-commit release evidence index', () => {
  assert.match(packageJson.scripts['test:engine-tenancy:evidence-index'], /write-engine-tenancy-release-index\.mjs/);
  assert.match(packageJson.scripts['test:engine-tenancy:release-evidence'], /--require-complete/);
  assert.match(packageJson.scripts['test:authz:state-space-local-evidence'], /--local-only/);
  for (const gate of [
    'traceability',
    'localEnforcement',
    'mutation',
    'browserMatrix',
    'browserAccessibility',
    'nativeGrantBrowser',
    'authorizationMatrix',
    'databaseMatrix',
    'provisioningJourneys',
    'sourceCoverage',
    'documentationReview',
    'compatibilityWindow',
  ]) {
    assert.match(releaseIndexWriter, new RegExp(`id: '${gate}'`));
  }
  assert.match(releaseIndexWriter, /sameCommit/);
  assert.match(releaseIndexWriter, /value\.sourceState === 'clean'/);
  assert.match(releaseIndexWriter, /releaseCommitQualified/);
  assert.match(releaseIndexWriter, /pending_approval/);
  assert.match(releaseIndexWriter, /documentationReviewEvidencePending/);
  assert.match(releaseIndexWriter, /passedGateCount === gateDefinitions\.length/);
  for (const matrixContract of [
    'constraint-derived-authorization-state-space',
    'canonicalInputHash',
    'classifiedCanonicalValueCount',
    'executedApplicableCellCount',
    'executedInvalidityWitnessCount',
    'unknownCells',
    'unexpectedCells',
  ]) {
    assert.match(releaseIndexWriter, new RegExp(matrixContract));
  }
  for (const completeReleaseContract of [
    'requiredDatabaseStages',
    'upgrade_baselines',
    'requiredAccessibilityChecks',
    'passedWorkflowCount',
    'supportedChannelExecutions',
    'compatibilityStatePasses',
    'warningBehaviorTestsPassed',
  ]) {
    assert.match(releaseIndexWriter, new RegExp(completeReleaseContract));
  }
  for (const reviewContract of [
    'unresolvedHighRiskFindings',
    'approvedCommit',
    'reviewer',
    'reviewMode',
    'reviewedAt',
    'evidenceLocation',
    'containsCredentials',
    'containsTokens',
  ]) {
    assert.match(documentationReviewContract, new RegExp(reviewContract));
  }
  assert.match(releaseIndexWriter, /documentationReviewEvidencePasses/);
  assert.match(releaseIndexWriter, /documentationReviewEvidenceFileExists/);
  assert.match(releaseIndexWriter, /README\.md/);
  assert.match(releaseIndexWriter, /process\.exitCode = 1/);
});

test('retains a local authenticated Camunda native-grant browser workflow as a release gate', () => {
  assert.match(packageJson.scripts['test:camunda-native-grant-browser-evidence'], /run-camunda-native-grant-browser-evidence\.sh/);
  for (const requiredField of [
    'read_only_native_inventory',
    'sanitized_preview_then_protected_mapping',
    'hash_bound_draft_and_apply',
    'identity_source_sync_effective_access_process_and_decision_allow_sibling_deny',
    'history_resume_and_hash_bound_rollback',
    'rollback_restores_denial',
    'releaseCommitQualified',
    'localhostOnly',
    'persistentDatabase',
    'authorizationEvaluator',
  ]) {
    assert.match(nativeGrantBrowserWriter, new RegExp(requiredField));
  }
  assert.match(nativeGrantBrowserRunner, /CAMUNDA_NATIVE_GRANT_BROWSER_EVIDENCE=true/);
  assert.match(nativeGrantBrowserRunner, /CAMUNDA_NATIVE_GRANT_TASK_DRAIN=true/);
  assert.match(nativeGrantBrowserRunner, /E2E_CAMUNDA_BASE_URL="http:\/\/camunda-mock:9080\/engine-rest"/);
  assert.match(nativeGrantBrowserRunner, /camunda-native-grant-migration\.spec\.ts/);
  assert.doesNotMatch(nativeGrantBrowserWriter, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('assembles provisioning evidence only from exact real-service observations', () => {
  assert.match(
    packageJson.scripts['test:engine-tenancy:provisioning-evidence'],
    /test:engine-tenancy:provisioning-journey-contract/,
  );
  assert.match(
    packageJson.scripts['test:engine-tenancy:provisioning-evidence'],
    /write-engine-tenancy-provisioning-evidence\.mjs/,
  );
  assert.match(
    packageJson.scripts['test:engine-tenancy:provisioning-journeys:local'],
    /run-engine-tenancy-provisioning-journeys\.sh/,
  );
  assert.equal(provisioningJourneyRegistry.journeys.length, 14);
  for (const requiredField of [
    'realHttpService',
    'persistentDatabase',
    'authorizationEvaluator',
    'userInterface',
    'missingChannelResults',
    'unexpectedChannelResults',
    'releaseCommitQualified',
  ]) {
    assert.match(provisioningEvidenceWriter, new RegExp(`\\b${requiredField}\\b`));
  }
  assert.match(provisioningEvidenceWriter, /\? 'passed'\s*: 'incomplete'/);
  assert.match(provisioningEvidenceWriter, /Provisioning-journey evidence must be assembled from a clean worktree/);
  assert.match(provisioningJourneyRunner, /ENGINE_TENANCY_PROVISIONING_EVIDENCE=true/);
  assert.match(provisioningJourneyRunner, /PLAYWRIGHT_BROWSERS=chromium/);
  assert.match(provisioningJourneyRunner, /POSTGRES_HOST=127\.0\.0\.1/);
  assert.doesNotMatch(
    provisioningEvidenceWriter,
    /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/,
  );
});

test('qualifies mutation evidence only for an exact clean commit', () => {
  assert.match(mutationWriter, /evidenceKind: 'engine-tenancy-targeted-mutation'/);
  assert.match(mutationWriter, /commit/);
  assert.match(mutationWriter, /sourceState/);
  assert.match(mutationWriter, /releaseCommitQualified/);
  assert.match(mutationWriter, /containsCredentials: false/);
  assert.match(mutationWriter, /containsTokens: false/);
});

test('retains complete constraint-derived authorization state-space evidence', () => {
  assert.match(packageJson.scripts['test:authz:state-space-evidence'], /run-authz-state-space-evidence\.mjs/);
  assert.match(packageJson.scripts['test:authz:state-space-foundation'], /run-local-safe-authz-state-space-foundation\.sh/);
  for (const requiredField of [
    'canonicalInputHash',
    'canonicalValueCount',
    'classifiedCanonicalValueCount',
    'rawTupleCount',
    'applicableCellCount',
    'executedApplicableCellCount',
    'equivalenceExpandedCellCount',
    'invalidityClassCount',
    'executedInvalidityWitnessCount',
    'missingCells',
    'skippedCells',
    'quarantinedCells',
    'unknownCells',
    'unexpectedCells',
  ]) {
    assert.match(authorizationMatrixRunner, new RegExp(`\\b${requiredField}\\b`));
  }
  assert.match(authorizationMatrixRunner, /status: localOnly \? 'incomplete' : 'passed'/);
  assert.match(authorizationMatrixRunner, /releaseCommitQualified: !localOnly && sourceState === 'clean'/);
  assert.match(authorizationMatrixRunner, /authorization-matrix\.local\.json/);
  assert.match(authorizationMatrixRunner, /deferredAcceptanceLanes/);
  assert.match(authorizationMatrixRunner, /generateAuthorizationBehaviorSummary/);
  assert.match(authorizationMatrixRunner, /behaviorCellHash/);
  assert.match(authorizationMatrixRunner, /customRoleUnionExpandedCombinationCount/);
  assert.match(authorizationMatrixRunner, /missingBehaviorClasses: \[\]/);
  assert.match(authorizationMatrixRunner, /run-local-safe-custom-role-matrix\.sh/);
  assert.match(authorizationMatrixRunner, /test:authz:local-smoke:cross-browser/);
  assert.match(authorizationMatrixRunner, /test:engine-tenancy:provisioning-journeys:local/);
  assert.match(authorizationMatrixRunner, /request-authorization-order-independence/);
  assert.match(authorizationMatrixRunner, /--sequence\.shuffle\.tests/);
  assert.match(authorizationMatrixRunner, /--sequence\.seed=1729/);
  assert.match(randomizedAuthorizationModel, /databaseModelTimeoutMs = 45_000/);
  assert.match(randomizedAuthorizationModel, /}, databaseModelTimeoutMs\);/);
  assert.match(authorizationMatrixRunner, /Authorization state-space evidence must be run from a clean worktree/);
  assert.match(authorizationMatrixRunner, /scripts\/local-safe-test\.env/);
  assert.match(authorizationMatrixRunner, /delete process\.env\[key\]/);
  assert.match(authorizationFoundationRunner, /scripts\/local-safe-test\.env/);
  assert.match(authorizationFoundationRunner, /unset DATABASE_TYPE DATABASE_URL POSTGRES_URL/);
  assert.doesNotMatch(authorizationMatrixRunner, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('retains database-free cross-browser accessibility evidence', () => {
  assert.match(packageJson.scripts['test:authz:accessibility:cross-browser'], /run-authz-accessibility-matrix\.sh/);
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    assert.match(accessibilityRunner, new RegExp(browser));
  }
  assert.match(accessibilityRunner, /E2E_SEED_USER=false/);
  assert.match(accessibilityRunner, /access-control-accessibility\.spec\.ts/);
  for (const check of [
    'error_announcement',
    'contrast',
    'zoom_200_reflow',
    'reduced_motion',
  ]) {
    assert.match(accessibilityWriter, new RegExp(check));
  }
  assert.match(accessibilityWriter, /workflowCount/);
  assert.match(accessibilityWriter, /passedWorkflowCount/);
  assert.match(accessibilityWriter, /missingChecks: 0/);
  assert.doesNotMatch(accessibilityWriter, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('retains omission warnings until the documented removal window closes', () => {
  assert.match(packageJson.scripts['test:engine-tenancy:compatibility-evidence'], /run-engine-tenancy-compatibility-evidence\.mjs/);
  assert.match(compatibilityRunner, /warningBehaviorTestsPassed: true/);
  assert.match(compatibilityRunner, /warningBehavior: 'retained'/);
  assert.match(compatibilityRunner, /removalProposed: false/);
  assert.match(compatibilityRunner, /ENGINE_TENANCY_DEFAULTED_TO_DEDICATED/);
  assert.match(compatibilityRunner, /test:engine-tenancy:engine-routes/);
  assert.match(compatibilityRunner, /Compatibility-window evidence must be run from a clean worktree/);
  assert.match(compatibilityRunner, /scripts\/local-safe-test\.env/);
  assert.doesNotMatch(compatibilityRunner, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('automates documentation checks without self-approving independent reviews', () => {
  assert.match(packageJson.scripts['test:engine-tenancy:documentation-review-evidence'], /run-engine-tenancy-documentation-review-evidence\.mjs/);
  assert.match(packageJson.scripts['record:engine-tenancy:documentation-review'], /record-engine-tenancy-documentation-review\.mjs/);
  assert.match(documentationReviewRunner, /test:engine-tenancy:documentation/);
  assert.match(documentationReviewRunner, /git', \['ls-files', 'docs\/\*\*\/\*\.md'/);
  assert.match(documentationReviewRunner, /preserveDocumentationReviews/);
  assert.match(documentationReviewRunner, /finalizeDocumentationReviewEvidence/);
  assert.doesNotMatch(documentationReviewRunner, /status: 'approved'/);
  assert.match(documentationReviewRunner, /Documentation-review evidence must be run from a clean worktree/);
  assert.match(documentationReviewRunner, /scripts\/local-safe-test\.env/);
  assert.match(documentationReviewRecorder, /Documentation approval must be recorded from a clean worktree/);
  assert.match(documentationReviewRecorder, /--reviewer/);
  assert.match(documentationReviewRecorder, /--review-mode/);
  assert.match(documentationReviewContract, /parseDocumentationReviewArguments/);
  assert.match(documentationReviewRecorder, /--evidence/);
  assert.match(documentationReviewRecorder, /approvedCommit: commit/);
  assert.match(documentationReviewRecorder, /test\/results\/engine-tenancy-review/);
  assert.match(documentationReviewContract, /pendingDocumentationReview/);
  assert.match(documentationReviewContract, /documentationReviewApprovalPasses/);
  assert.doesNotMatch(documentationReviewRunner, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});

test('requires real five-adapter database qualification evidence', () => {
  assert.match(
    packageJson.scripts['test:engine-tenancy:database-matrix'],
    /run-engine-tenancy-database-matrix\.mjs/,
  );
  assert.deepEqual(
    Object.keys(databaseMatrixContract.databases),
    ['postgres', 'mysql', 'mssql', 'oracle', 'spanner'],
  );
  assert.deepEqual(databaseMatrixContract.requiredStages, [
    'clean_install',
    'upgrade_baselines',
    'interrupted_retry',
    'schema_equivalence',
    'service_behavior',
    'rollback',
    'cleanup',
  ]);
  assert.equal(databaseMatrixContract.upgradeBaselines.length, 2);
  assert.match(databaseMatrixRunner, /schemaFingerprints\.size === 1/);
  assert.match(databaseMatrixRunner, /releaseCommitQualified: status === 'passed' && sourceState === 'clean'/);
  assert.match(databaseMatrixRunner, /Database-matrix evidence must be run from a clean worktree/);
  assert.match(databaseMatrixRunner, /backend\/test\/integration\/engine-tenancy-database-qualification\.mjs/);
  assert.doesNotMatch(
    databaseMatrixRunner,
    /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/,
  );
});

test('retains literal 100 percent source coverage for every security-critical module lane', () => {
  assert.match(packageJson.scripts['test:engine-tenancy:source-coverage'], /run-engine-tenancy-source-coverage\.mjs/);
  assert.match(
    packageJson.scripts['test:engine-tenancy:engine-routes'],
    /mission-control\/engines\/routes\.test\.ts/,
  );
  assert.match(
    packageJson.scripts['test:engine-tenancy:engine-routes'],
    /--sequence\.shuffle\.tests --sequence\.seed=1729/,
  );
  for (const script of [
    'test:engine-tenancy:provisioning',
    'test:engine-tenancy:mappings',
    'test:engine-tenancy:authorization',
    'test:engine-tenancy:runtime',
    'test:engine-tenancy:transitions',
    'test:engine-tenancy:operations',
    'test:authz:machine-principal-coverage',
    'test:authz:policy-coverage',
    'test:authz:api-client-middleware-coverage',
  ]) {
    assert.match(sourceCoverageRunner, new RegExp(`script: '${script}'`));
  }
  for (const script of [
    'test:engine-tenancy:provisioning',
    'test:engine-tenancy:mappings',
    'test:engine-tenancy:transitions',
  ]) {
    assert.match(
      packageJson.scripts[script],
      /pnpm run test:engine-tenancy:engine-routes/,
    );
  }
  assert.match(sourceCoverageRunner, /lines: 100/);
  assert.match(sourceCoverageRunner, /statements: 100/);
  assert.match(sourceCoverageRunner, /branches: 100/);
  assert.match(sourceCoverageRunner, /functions: 100/);
  assert.match(sourceCoverageRunner, /Source-coverage evidence must be run from a clean worktree/);
  assert.match(sourceCoverageRunner, /Source changed while coverage evidence was running/);
  assert.match(sourceCoverageRunner, /scripts\/local-safe-test\.env/);
  assert.match(sourceCoverageRunner, /delete safeEnvironment\[key\]/);
  assert.match(sourceCoverageRunner, /source-coverage\.json/);
  assert.doesNotMatch(sourceCoverageRunner, /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/);
});
