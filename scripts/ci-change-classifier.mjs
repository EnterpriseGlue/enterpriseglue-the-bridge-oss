#!/usr/bin/env node

import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const booleanOutputs = [
  'metadata_only',
  'frontend',
  'backend',
  'persistence',
  'engine_integration',
  'authorization',
  'plugin_contract',
  'plugin_packaging',
  'application_container',
  'toolchain_container',
  'helm',
  'workflow_or_release',
  'unknown_high_risk',
  'run_tests',
  'run_postgres',
  'run_oracle',
  'run_smoke',
  'run_documentation_guard',
  'run_boundary_guards',
  'run_plugin_checks',
  'run_plugin_package',
  'run_plugin_images',
  'run_package_discipline',
  'run_compose_render',
  'run_ci_images',
  'run_security_scan',
  'run_smoke_exposed',
  'run_native_tenancy',
  'run_release_readiness',
  'run_adapter_backstop',
  'run_engine_browser',
  'run_database_matrix',
  'run_identity_rehearsal',
  'run_deployment_evidence',
];

const metadataPatterns = [
  /^\.release-notes\/(?!schema\.json$)[a-z0-9][a-z0-9-]*\.json$/,
  /^docs\//,
  /^(?:README|CHANGELOG|CODE_OF_CONDUCT|CONTRIBUTING|SECURITY|SUPPORT)\.md$/,
  /^(?:LICENSE|NOTICE)$/,
  /^(?:THIRD_PARTY_NOTICES\.md|third_party_licenses\.json)$/,
  /^\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\//,
  /^\.github\/(?:CODEOWNERS|dependabot\.yml)$/,
  /^(?:\.sync|\.windsurf|\.vscode|archive)\//,
];

const rootDependencyPattern = /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;

const identityRehearsalPatterns = [
  /^\.github\/workflows\/(?:identity-protocol-rehearsal|entra-id-rehearsal)\.yml$/,
  /^(?:backend|frontend|packages\/(?:backend-host|frontend-host|shared))\/.*(?:identity|sso|oidc|saml|ldap|login)/i,
  /^scripts\/.*(?:identity|sso|oidc|saml|ldap|keycloak)/i,
  /^test\/e2e\/.*(?:identity|sso|oidc|saml|ldap|login)/i,
  /^infra\/docker\/(?:keycloak|.*identity|.*sso)/i,
];

const deploymentEvidencePatterns = [
  /^\.github\/workflows\/access-governance-deployment-evidence\.yml$/,
  /^scripts\/(?:run-deployment-evidence-matrix|record-deployment-external-evidence|deployment-evidence-matrix)/,
  /^test\/authz\/deployment-evidence-matrix(?:\.schema)?\.json$/,
  /^(?:backend|frontend|packages\/(?:backend-host|frontend-host|shared))\/.*(?:authz|authorization|permission|identity|tenant|deployment)/i,
  /^infra\/(?:docker|kubernetes)\/.*(?:auth|identity|tenant|deploy)/i,
];

const classifiers = {
  frontend: [
    /^frontend\/(?!Dockerfile)/,
    /^packages\/frontend-host\//,
    /^packages\/(?:shared|enterprise-plugin-api|plugin-manager)\//,
    /^test\/e2e\//,
    rootDependencyPattern,
    /^(?:eslint|tsconfig|vitest|vite)[^/]*\.(?:js|mjs|cjs|json|ts)$/,
  ],
  backend: [
    /^backend\/(?!Dockerfile)/,
    /^packages\/(?:backend-host|shared|enterprise-plugin-api|plugin-manager)\//,
    /^test\/(?:database|integration)\//,
    rootDependencyPattern,
    /^(?:eslint|tsconfig|vitest)[^/]*\.(?:js|mjs|cjs|json|ts)$/,
  ],
  persistence: [
    /^packages\/shared\/src\/(?:db|config|infrastructure\/persistence)\//,
    /^backend\/src\/shared\/(?:db|config)\//,
    /^backend\/(?:__tests__\/shared\/db|test\/integration\/engine-tenancy-database)/,
    /^backend\/src\/modules\/.*(?:db|migration)/,
    /^backend\/.*migration/,
    /^test\/database\//,
    /^scripts\/(?:run-engine-tenancy-database-matrix|engine-tenancy-database-matrix|check-migration-identifiers)/,
    /^\.github\/workflows\/engine-tenancy-database\.yml$/,
  ],
  engine_integration: [
    /^packages\/shared\/src\/(?:services\/bpmn-engine-client|schemas\/mission-control)\//,
    /^packages\/backend-host\/src\/modules\/mission-control\//,
    /^packages\/frontend-host\/src\/features\/mission-control\//,
    /^backend\/(?:__tests__|test)\/.*mission-control/,
    /^frontend\/__tests__\/.*mission-control/,
    /^test\/e2e\/(?:operaton|camunda7-container|mock-camunda|mission-control|smoke\/mission-control)/,
    /^scripts\/(?:run-operaton|write-operaton|run-camunda-native|write-camunda-native)/,
  ],
  authorization: [
    /^packages\/(?:backend-host|frontend-host|shared)\/src\/.*(?:auth|permission|tenan|identity|sso|group|role)/i,
    /^backend\/(?:__tests__|test)\/.*(?:auth|permission|tenan|identity|sso|group|role)/i,
    /^frontend\/__tests__\/.*(?:auth|permission|tenan|identity|sso|group|role)/i,
    /^test\/(?:authz|e2e\/.*(?:auth|permission|tenan|identity|sso|group|role))/i,
    /^scripts\/.*(?:authz|authorization|tenan|identity|sso|oidc|saml|ldap)/i,
    /^\.github\/workflows\/(?:authz-pr|identity-protocol-rehearsal|entra-id-rehearsal|engine-tenancy-database)\.yml$/,
  ],
  plugin_contract: [
    /^packages\/(?:enterprise-plugin-api|plugin-sdk|plugin-runtime|plugin-installer|plugin-manager|plugin-reference)\//,
    /^packages\/(?:backend-host|frontend-host)\/src\/(?:plugins|enterprise)\//,
    /^packages\/(?:backend-host|frontend-host)\/(?:examples|test)\//,
    /^scripts\/.*plugin-(?:api|boot|compose|consumer|installer|manager|platform|reference|runtime)/,
    /^test\/e2e\/plugin-platform/,
  ],
  plugin_packaging: [
    /^packages\/(?:enterprise-plugin-api|plugin-sdk|plugin-runtime|plugin-installer|plugin-manager)\/package\.json$/,
    /^scripts\/(?:publish-(?:plugin|host)-package-set|verify-(?:plugin|host)-package-tarballs|package-tarball-contract|check-published-package-version-discipline|check-workspace-dependency-version-drift|enterpriseglue-distribution-lock)/,
    /^\.github\/workflows\/(?:plugin-package-release|publish-(?:backend-host|frontend-host|plugin-api|shared))\.yml$/,
    rootDependencyPattern,
  ],
  application_container: [
    /^(?:backend|frontend)\/Dockerfile(?:\.prod)?$/,
    /^infra\/docker\//,
    /^scripts\/(?:smoke-images-local|e2e-smoke-postgres-images|run-trivy-image-scan|check-release-dockerfile-pins)/,
    /^\.github\/workflows\/(?:docker-images|docker-images-reusable|security-nightly|security-nightly-reusable)\.yml$/,
  ],
  toolchain_container: [
    /^packages\/(?:plugin-installer|plugin-manager)\/Dockerfile/,
    /^scripts\/.*(?:plugin-toolchain|plugin-platform-production-images|plugin-reference-image|paid-plugin-image-boundary)/,
    /^\.github\/workflows\/plugin-(?:toolchain-release|platform-(?:mysql|mssql|oracle|spanner))\.yml$/,
  ],
  helm: [
    /^infra\/kubernetes\/helm\//,
    /^scripts\/(?:helm-chart-archive|check-enterpriseglue-host-chart|check-plugin-platform-chart|check-host-chart-release-policy|plan-plugin-toolchain-charts|sync-host-chart-release-version)/,
    /^\.github\/workflows\/(?:host-chart-release|plugin-toolchain-release)\.yml$/,
  ],
  workflow_or_release: [
    /^\.github\/(?:workflows|actions)\//,
    /^\.release-notes\/schema\.json$/,
    /^plugins\/enterpriseglue-dev-workflows\//,
    /^scripts\/(?:check-ci-aggregate-contract|ci-(?:change-classifier|change-detection|observability)|dedupe-release-changelog|engine-compatibility-workflow|published-package-workflow|security-workflow-contract|evaluate-ci-needs|release-|run-release-|prepare-release-|fetch-release-candidate|publish-(?:plugin|host)-package-set|verify-(?:plugin|host)-package-tarballs|package-tarball-contract|check-(?:release|plugin-package-release|plugin-toolchain-release|host-chart-release|published-package-version-discipline|workspace-dependency-version-drift)|plan-plugin-toolchain-charts|helm-chart-archive)/,
    /^docs\/runbooks\/release-artifact-promotion\.md$/,
    /^docs\/development\/(?:ci-and-release-routing|release-notes-process|codex-workflow-plugin)\.md$/,
  ],
  native_tenancy: [
    /^packages\/(?:backend-host|frontend-host|shared)\/src\/.*(?:native-tenan|tenant-(?:database|discovery|login)|pooled-tenan)/i,
    /^backend\/(?:__tests__|test)\/.*(?:nativeTenan|pooled-tenan|tenant-database)/i,
    /^frontend\/__tests__\/.*(?:NativeTenant|pooled-tenan|tenant.*Login)/i,
    /^test\/e2e\/pooled-tenancy/,
    /^scripts\/(?:run-native-tenancy|run-pooled-tenancy|saas-upgrade-restore-rollback)/,
  ],
  adapter_backstop: [
    /^test\/e2e\/(?:operaton|camunda7-container)/,
    /^scripts\/(?:run-operaton|run-camunda-native|write-camunda-native)/,
    /^packages\/shared\/src\/(?:services\/bpmn-engine-client|schemas\/platform-admin\/(?:engine-backstop|camunda-native-grants))/,
    /^packages\/(?:backend-host|frontend-host)\/src\/.*(?:engineBackstop|EngineBackstop|camunda-native)/,
    /^backend\/(?:__tests__|test)\/.*(?:engineBackstop|EngineBackstop|bpmn-engine-client|camunda-native)/,
  ],
};

function normalizePath(value) {
  const path = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  assert.ok(path && !path.startsWith('/') && !path.split('/').includes('..'), `invalid changed path: ${value}`);
  return path;
}

function matches(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

function fullClassification({ enablePluginPackage }) {
  const result = Object.fromEntries(
    booleanOutputs.map((key) => [key, key === 'metadata_only' ? false : true]),
  );
  return {
    ...result,
    run_plugin_package: enablePluginPackage,
    test_databases: ['postgres', 'oracle'],
    changed_files_count: 'all',
    selected_classes: ['full'],
  };
}

export function classifyChangedFiles(rawPaths, {
  enablePluginPackage = true,
  securityScanOnSmokeOnly = true,
  forceFull = false,
} = {}) {
  assert.ok(Array.isArray(rawPaths), 'changed files must be an array');
  if (forceFull) return fullClassification({ enablePluginPackage });

  const paths = [...new Set(rawPaths.filter((value) => String(value || '').trim()).map(normalizePath))].sort();
  const raw = {};
  for (const [name, patterns] of Object.entries(classifiers)) {
    raw[name] = paths.some((path) => matches(path, patterns));
  }

  const metadataOnly = paths.length > 0 && paths.every((path) => matches(path, metadataPatterns));
  const known = (path) => matches(path, metadataPatterns)
    || Object.values(classifiers).some((patterns) => matches(path, patterns))
    || matches(path, identityRehearsalPatterns)
    || matches(path, deploymentEvidencePatterns);
  const unknownHighRisk = paths.some((path) => !known(path));
  const runTests = raw.backend || raw.frontend || raw.persistence || raw.engine_integration
    || raw.authorization || unknownHighRisk;
  const runPostgres = runTests;
  const runOracle = raw.persistence || unknownHighRisk;
  const runCiImages = raw.application_container || unknownHighRisk;
  const runSmoke = runCiImages;
  const runDocumentationGuard = paths.some((path) => path.startsWith('docs/') || /\.md$/i.test(path));
  const runPluginChecks = raw.plugin_contract || unknownHighRisk;
  const runPluginPackage = enablePluginPackage && (raw.plugin_packaging || raw.plugin_contract || unknownHighRisk);
  const runPluginImages = raw.toolchain_container || raw.plugin_contract || unknownHighRisk;
  const runPackageDiscipline = raw.plugin_packaging || unknownHighRisk;
  const runComposeRender = raw.application_container || raw.helm || unknownHighRisk;
  const runSecurityScan = securityScanOnSmokeOnly ? runCiImages : (runCiImages || raw.toolchain_container);
  const runReleaseReadiness = raw.workflow_or_release || raw.plugin_packaging || raw.toolchain_container
    || raw.helm || raw.application_container || unknownHighRisk;
  const runDatabaseMatrix = raw.persistence || unknownHighRisk;
  const runIdentityRehearsal = paths.some((path) => matches(path, identityRehearsalPatterns)) || unknownHighRisk;
  const runDeploymentEvidence = paths.some((path) => matches(path, deploymentEvidencePatterns)) || unknownHighRisk;

  const result = {
    metadata_only: metadataOnly,
    frontend: raw.frontend,
    backend: raw.backend,
    persistence: raw.persistence,
    engine_integration: raw.engine_integration,
    authorization: raw.authorization,
    plugin_contract: raw.plugin_contract,
    plugin_packaging: raw.plugin_packaging,
    application_container: raw.application_container,
    toolchain_container: raw.toolchain_container,
    helm: raw.helm,
    workflow_or_release: raw.workflow_or_release,
    unknown_high_risk: unknownHighRisk,
    run_tests: runTests,
    run_postgres: runPostgres,
    run_oracle: runOracle,
    run_smoke: runSmoke,
    run_documentation_guard: runDocumentationGuard,
    run_boundary_guards: paths.length > 0 && !metadataOnly,
    run_plugin_checks: runPluginChecks,
    run_plugin_package: runPluginPackage,
    run_plugin_images: runPluginImages,
    run_package_discipline: runPackageDiscipline,
    run_compose_render: runComposeRender,
    run_ci_images: runCiImages,
    run_security_scan: runSecurityScan,
    run_smoke_exposed: runCiImages,
    run_native_tenancy: raw.native_tenancy || unknownHighRisk,
    run_release_readiness: runReleaseReadiness,
    run_adapter_backstop: raw.adapter_backstop || unknownHighRisk,
    run_engine_browser: raw.engine_integration || raw.persistence || unknownHighRisk,
    run_database_matrix: runDatabaseMatrix,
    run_identity_rehearsal: runIdentityRehearsal,
    run_deployment_evidence: runDeploymentEvidence,
    test_databases: runOracle ? ['postgres', 'oracle'] : ['postgres'],
    changed_files_count: String(paths.length),
    selected_classes: [
      metadataOnly ? 'metadata_only' : null,
      ...Object.keys(classifiers).filter((name) => raw[name]),
      unknownHighRisk ? 'unknown_high_risk' : null,
    ].filter(Boolean),
  };

  for (const key of booleanOutputs) assert.equal(typeof result[key], 'boolean', `missing boolean output: ${key}`);
  return result;
}

export function renderClassifierSummary(result) {
  const enabledLanes = booleanOutputs.filter((key) => key.startsWith('run_') && result[key]);
  return [
    '## CI change classification',
    '',
    `- Changed files: ${result.changed_files_count}`,
    `- Classes: ${result.selected_classes.join(', ') || 'none'}`,
    `- Selected lanes: ${enabledLanes.join(', ') || 'policy/preflight only'}`,
    `- Database matrix: ${result.test_databases.join(', ')}`,
    '',
  ].join('\n');
}

function parseArguments(argv) {
  const options = { enablePluginPackage: true, securityScanOnSmokeOnly: true, forceFull: false };
  let changedFilesPath = '';
  let githubOutput = '';
  let summaryPath = '';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--changed-files') changedFilesPath = argv[++index] || '';
    else if (value === '--github-output') githubOutput = argv[++index] || '';
    else if (value === '--summary') summaryPath = argv[++index] || '';
    else if (value === '--full') options.forceFull = true;
    else if (value === '--disable-plugin-package') options.enablePluginPackage = false;
    else if (value === '--security-on-container-or-toolchain') options.securityScanOnSmokeOnly = false;
    else throw new Error(`unknown argument: ${value}`);
  }
  return { changedFilesPath, githubOutput, summaryPath, options };
}

function main() {
  const { changedFilesPath, githubOutput, summaryPath, options } = parseArguments(process.argv.slice(2));
  assert.ok(options.forceFull || changedFilesPath, '--changed-files or --full is required');
  const paths = changedFilesPath
    ? readFileSync(changedFilesPath, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];
  const result = classifyChangedFiles(paths, options);
  if (githubOutput) {
    const lines = [
      ...booleanOutputs.map((key) => `${key}=${result[key]}`),
      `test_databases=${JSON.stringify(result.test_databases)}`,
      `changed_files_count=${result.changed_files_count}`,
      `selection_summary=${JSON.stringify(result.selected_classes)}`,
    ];
    appendFileSync(githubOutput, `${lines.join('\n')}\n`);
  }
  if (summaryPath) appendFileSync(summaryPath, renderClassifierSummary(result));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
