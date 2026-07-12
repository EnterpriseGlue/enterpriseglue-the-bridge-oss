#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

let listAuthzActions;
try {
  ({ listAuthzActions } = await import('../packages/shared/dist/authz/permission-actions.js'));
} catch (error) {
  console.error('[authz-test-coverage] Failed to load shared authz registry from packages/shared/dist.');
  console.error('[authz-test-coverage] Run `pnpm --filter ./packages/shared run build` before this guard.');
  console.error(error?.message || error);
  process.exit(1);
}

const repoRoot = process.cwd();
const testRoots = [
  'backend/__tests__',
  'backend/test',
  'frontend/__tests__',
];

const explicitActionPatterns = [
  /\bactionId\s*[:=]\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\brequireAction\s*\(\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\brequireCompositeAction\s*\(\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\buseActionDecision\s*\(\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\buseCanAction\s*\(\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\bevaluateActionSnapshot\s*\([^,]+,\s*['"]([A-Za-z0-9._:-]+)['"]/g,
];
const stringLiteralPattern = /['"]([A-Za-z][A-Za-z0-9_-]*(?:[.:][A-Za-z0-9_-]+)+)['"]/g;

const criticalCoverageCategories = new Set([
  'Access Control',
  'SSO',
  'Deployments',
  'Engine Inventory',
  'Engine Secrets',
  'Engine Members',
  'Engine Governance',
  'Engine Environment',
  'Project Engine Targets',
  'Projects',
  'Project Members',
  'Project Files',
  'Project Versions',
  'Git',
  'Mission Control',
  'Mission Control Batches',
  'Mission Control Decisions',
  'Mission Control Direct Actions',
  'Mission Control External Tasks',
  'Mission Control Jobs',
  'Mission Control Messages',
  'Mission Control Migrations',
  'Mission Control Process Definitions',
  'Mission Control Process Instances',
  'Mission Control Signals',
  'Mission Control Tasks',
  'Audit',
]);

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', '.vite'].includes(entry.name)) continue;
      files.push(...walkFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function lineAndColumn(content, index) {
  const before = content.slice(0, index);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const explicitActionMatches = [];
  const stringLiteralMatches = [];

  for (const pattern of explicitActionPatterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const location = lineAndColumn(content, match.index || 0);
      explicitActionMatches.push({
        value: match[1],
        filePath: relativePath(filePath),
        line: location.line,
        column: location.column,
      });
    }
  }

  stringLiteralPattern.lastIndex = 0;
  for (const match of content.matchAll(stringLiteralPattern)) {
    const location = lineAndColumn(content, match.index || 0);
    stringLiteralMatches.push({
      value: match[1],
      filePath: relativePath(filePath),
      line: location.line,
      column: location.column,
    });
  }

  return { explicitActionMatches, stringLiteralMatches };
}

function percent(part, total) {
  if (total === 0) return 100;
  return Math.round((part / total) * 1000) / 10;
}

function summarizeCategory(actions, directlyReferencedActionIds, referencedPermissionIds) {
  const direct = actions.filter((action) => directlyReferencedActionIds.has(action.actionId)).length;
  const permission = actions.filter((action) => referencedPermissionIds.has(action.permissionId)).length;
  const covered = actions.filter(
    (action) => directlyReferencedActionIds.has(action.actionId) || referencedPermissionIds.has(action.permissionId)
  ).length;
  const highRiskAudited = actions.filter(
    (action) => action.audit && (action.risk === 'high' || action.risk === 'critical')
  );
  const highRiskDirect = highRiskAudited.filter((action) => directlyReferencedActionIds.has(action.actionId)).length;

  return {
    total: actions.length,
    direct,
    permission,
    covered,
    highRiskAudited: highRiskAudited.length,
    highRiskDirect,
  };
}

const registeredActions = listAuthzActions();
const actionById = new Map(registeredActions.map((action) => [action.actionId, action]));
const permissionIds = new Set(registeredActions.map((action) => action.permissionId));
const files = testRoots
  .flatMap((testRoot) => walkFiles(path.join(repoRoot, testRoot)))
  .sort((left, right) => left.localeCompare(right));

const scanResults = files.map(scanFile);
const explicitActionMatches = scanResults.flatMap((result) => result.explicitActionMatches);
const stringLiteralMatches = scanResults.flatMap((result) => result.stringLiteralMatches);
const directlyReferencedActionIds = new Set(
  stringLiteralMatches
    .map((match) => match.value)
    .filter((value) => actionById.has(value))
);
const referencedPermissionIds = new Set(
  stringLiteralMatches
    .map((match) => match.value)
    .filter((value) => permissionIds.has(value))
);
const unknownExplicitActions = explicitActionMatches.filter((match) => !actionById.has(match.value));

if (unknownExplicitActions.length > 0) {
  console.error('[authz-test-coverage] Unknown explicit test action ids found.');
  console.error('[authz-test-coverage] Use action ids from @enterpriseglue/shared/authz/permission-actions.');
  const byId = new Map();
  for (const match of unknownExplicitActions) {
    const entries = byId.get(match.value) || [];
    entries.push(match);
    byId.set(match.value, entries);
  }
  for (const [actionId, locations] of [...byId.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    console.error(`- ${actionId}`);
    for (const location of locations.slice(0, 10)) {
      console.error(`  ${location.filePath}:${location.line}:${location.column}`);
    }
  }
  process.exit(1);
}

const actionsByCategory = new Map();
for (const action of registeredActions) {
  const actions = actionsByCategory.get(action.category) || [];
  actions.push(action);
  actionsByCategory.set(action.category, actions);
}

const directCoverage = percent(directlyReferencedActionIds.size, registeredActions.length);
const criticalActions = registeredActions.filter((action) => criticalCoverageCategories.has(action.category));
const highRiskAuditedActions = criticalActions.filter(
  (action) => action.audit && (action.risk === 'high' || action.risk === 'critical')
);
const directHighRiskAuditedActions = highRiskAuditedActions.filter((action) => directlyReferencedActionIds.has(action.actionId));
const missingHighRiskAuditedActions = highRiskAuditedActions
  .filter((action) => !directlyReferencedActionIds.has(action.actionId))
  .sort((left, right) => left.category.localeCompare(right.category) || left.actionId.localeCompare(right.actionId));

console.log(
  `[authz-test-coverage] OK (${directlyReferencedActionIds.size}/${registeredActions.length} ` +
  `registered action ids directly referenced in tests, ${directCoverage}%).`
);
console.log(
  `[authz-test-coverage] ${referencedPermissionIds.size} permission ids referenced across ${files.length} test files.`
);
console.log(
  `[authz-test-coverage] Critical-category high/critical audited direct coverage: ` +
  `${directHighRiskAuditedActions.length}/${highRiskAuditedActions.length} ` +
  `(${percent(directHighRiskAuditedActions.length, highRiskAuditedActions.length)}%).`
);

console.log('[authz-test-coverage] Category matrix: category | actions | direct | permission | direct-or-permission | high/critical audited direct');
for (const [category, actions] of [...actionsByCategory.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const summary = summarizeCategory(actions, directlyReferencedActionIds, referencedPermissionIds);
  const marker = criticalCoverageCategories.has(category) ? '*' : '-';
  console.log(
    `[authz-test-coverage] ${marker} ${category} | ${summary.total} | ${summary.direct} | ` +
    `${summary.permission} | ${summary.covered} | ${summary.highRiskDirect}/${summary.highRiskAudited}`
  );
}

if (missingHighRiskAuditedActions.length > 0) {
  console.log(
    `[authz-test-coverage] Missing direct high/critical audited test action references: ` +
    `${missingHighRiskAuditedActions.length} (reported for the coverage backlog; not a failure).`
  );
  for (const action of missingHighRiskAuditedActions.slice(0, 40)) {
    console.log(
      `[authz-test-coverage] missing ${action.actionId} | ${action.category} | ` +
      `${action.risk} | ${action.permissionId}`
    );
  }
  if (missingHighRiskAuditedActions.length > 40) {
    console.log(`[authz-test-coverage] ... ${missingHighRiskAuditedActions.length - 40} more`);
  }
}
