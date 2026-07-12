#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

let listAuthzActions;
try {
  ({ listAuthzActions } = await import('../packages/shared/dist/authz/permission-actions.js'));
} catch (error) {
  console.error('[frontend-authz-coverage] Failed to load shared authz registry from packages/shared/dist.');
  console.error('[frontend-authz-coverage] Run `pnpm --filter ./packages/shared run build` before this guard.');
  console.error(error?.message || error);
  process.exit(1);
}

const repoRoot = process.cwd();
const sourceRoots = [
  'packages/frontend-host/src',
  'frontend/src',
];

const actionIdPatterns = [
  /\buseActionDecision\s*\(\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\buseCanAction\s*\(\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\bevaluateActionSnapshot\s*\([^,]+,\s*['"]([A-Za-z0-9._:-]+)['"]/g,
  /\bactionId\s*[:=]\s*['"]([A-Za-z0-9._:-]+)['"]/g,
];
const stringLiteralPattern = /['"]([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)['"]/g;

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

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
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

  for (const pattern of actionIdPatterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const actionId = match[1];
      const location = lineAndColumn(content, match.index || 0);
      explicitActionMatches.push({
        actionId,
        filePath: relativePath(filePath),
        line: location.line,
        column: location.column,
      });
    }
  }

  stringLiteralPattern.lastIndex = 0;
  for (const match of content.matchAll(stringLiteralPattern)) {
    const actionId = match[1];
    const location = lineAndColumn(content, match.index || 0);
    stringLiteralMatches.push({
      actionId,
      filePath: relativePath(filePath),
      line: location.line,
      column: location.column,
    });
  }

  return { explicitActionMatches, stringLiteralMatches };
}

const registeredActions = listAuthzActions();
const actionById = new Map(registeredActions.map((action) => [action.actionId, action]));
const uiActionIds = new Set(
  registeredActions
    .filter((action) => Array.isArray(action.ui) && action.ui.some((surface) => (surface.coverage || 'frontend') === 'frontend'))
    .map((action) => action.actionId)
);

const files = sourceRoots
  .flatMap((sourceRoot) => walkFiles(path.join(repoRoot, sourceRoot)))
  .sort((a, b) => a.localeCompare(b));

const scanResults = files.map(scanFile);
const explicitActionMatches = scanResults.flatMap((result) => result.explicitActionMatches);
const stringLiteralMatches = scanResults.flatMap((result) => result.stringLiteralMatches);
const registeredStringLiteralMatches = stringLiteralMatches.filter((match) => actionById.has(match.actionId));
const usedActionIds = new Set(registeredStringLiteralMatches.map((match) => match.actionId));
const unknownMatches = explicitActionMatches.filter((match) => !actionById.has(match.actionId));
const unknownById = new Map();

for (const match of unknownMatches) {
  const entries = unknownById.get(match.actionId) || [];
  entries.push(match);
  unknownById.set(match.actionId, entries);
}

if (unknownById.size > 0) {
  console.error('[frontend-authz-coverage] Unknown frontend action ids found.');
  console.error('[frontend-authz-coverage] Use action ids from @enterpriseglue/shared/authz/permission-actions.');
  for (const [actionId, locations] of [...unknownById.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    console.error(`- ${actionId}`);
    for (const location of locations.slice(0, 10)) {
      console.error(`  ${location.filePath}:${location.line}:${location.column}`);
    }
  }
  process.exit(1);
}

const usedRegisteredUiActionIds = [...usedActionIds].filter((actionId) => uiActionIds.has(actionId));
const unreferencedUiActionIds = [...uiActionIds]
  .filter((actionId) => !usedActionIds.has(actionId))
  .sort((left, right) => left.localeCompare(right));
const coverage = uiActionIds.size === 0
  ? 100
  : Math.round((usedRegisteredUiActionIds.length / uiActionIds.size) * 1000) / 10;

const usedByCategory = new Map();
for (const actionId of usedRegisteredUiActionIds) {
  const action = actionById.get(actionId);
  const category = action?.category || 'Uncategorized';
  usedByCategory.set(category, (usedByCategory.get(category) || 0) + 1);
}

console.log(
  `[frontend-authz-coverage] OK (${usedRegisteredUiActionIds.length}/${uiActionIds.size} ` +
  `registered UI action ids referenced, ${coverage}%).`
);
console.log(
  `[frontend-authz-coverage] ${registeredStringLiteralMatches.length} registered action-id references ` +
  `(${explicitActionMatches.length} explicit guard/action-id parameters) across ${files.length} source files.`
);
console.log(
  `[frontend-authz-coverage] Used categories: ${
    [...usedByCategory.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => `${category}=${count}`)
      .join(', ') || 'none'
  }`
);
if (unreferencedUiActionIds.length > 0) {
  console.log(
    `[frontend-authz-coverage] Unreferenced registered UI action ids: ${unreferencedUiActionIds.length} ` +
    '(reported for migration inventory; not a failure).'
  );
  for (const actionId of unreferencedUiActionIds.slice(0, 25)) {
    console.log(`[frontend-authz-coverage] unreferenced ${actionId}`);
  }
  if (unreferencedUiActionIds.length > 25) {
    console.log(`[frontend-authz-coverage] ... ${unreferencedUiActionIds.length - 25} more`);
  }
}
