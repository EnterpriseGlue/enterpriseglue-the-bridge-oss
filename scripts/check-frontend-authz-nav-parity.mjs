#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

let listAuthzActions;
try {
  ({ listAuthzActions } = await import('../packages/shared/dist/authz/permission-actions.js'));
} catch (error) {
  console.error('[frontend-authz-nav-parity] Failed to load shared authz registry from packages/shared/dist.');
  console.error('[frontend-authz-nav-parity] Run `pnpm --filter ./packages/shared run build` before this guard.');
  console.error(error?.message || error);
  process.exit(1);
}

const repoRoot = process.cwd();
const layoutPath = path.join(repoRoot, 'packages/frontend-host/src/features/shared/components/LayoutWithProSidebar.tsx');
const layoutSource = fs.readFileSync(layoutPath, 'utf8');
const actionsById = new Map(listAuthzActions().map((action) => [action.actionId, action]));
const issues = [];

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function extractAdminNavItems(source) {
  const blockMatch = source.match(/const\s+adminNavItems:\s*AdminNavItem\[\]\s*=\s*\[([\s\S]*?)\]\.filter/);
  if (!blockMatch) {
    issues.push('Could not find the Admin nav item declaration in LayoutWithProSidebar.tsx.');
    return [];
  }

  const block = blockMatch[1];
  const itemPattern = /label:\s*'([^']+)'[\s\S]*?path:\s*'([^']+)'[\s\S]*?actionIds:\s*\[([\s\S]*?)\]/g;
  const actionPattern = /'([^']+)'/g;
  const items = [];

  for (const match of block.matchAll(itemPattern)) {
    const [, label, navPath, actionBlock] = match;
    const actionIds = [...actionBlock.matchAll(actionPattern)].map((actionMatch) => actionMatch[1]);
    items.push({ label, path: navPath, actionIds });
  }

  return items;
}

const adminNavItems = extractAdminNavItems(layoutSource);
if (adminNavItems.length === 0) {
  issues.push('No Admin nav items with actionIds were found.');
}

const seenPaths = new Map();
for (const item of adminNavItems) {
  if (!item.path.startsWith('/admin/')) {
    issues.push(`${item.label} uses non-admin nav path ${item.path}.`);
  }

  if (seenPaths.has(item.path)) {
    issues.push(`${item.label} reuses Admin nav path ${item.path} from ${seenPaths.get(item.path)}.`);
  }
  seenPaths.set(item.path, item.label);

  if (item.actionIds.length === 0) {
    issues.push(`${item.label} has no actionIds.`);
    continue;
  }

  const unknownActionIds = item.actionIds.filter((actionId) => !actionsById.has(actionId));
  for (const actionId of unknownActionIds) {
    issues.push(`${item.label} references unknown action id ${actionId}.`);
  }

  const routeBackedActionIds = item.actionIds.filter((actionId) => {
    const action = actionsById.get(actionId);
    return Array.isArray(action?.routes) && action.routes.some((route) => route.openApi !== false);
  });

  if (unknownActionIds.length === 0 && routeBackedActionIds.length === 0) {
    issues.push(`${item.label} has no route-backed action candidate.`);
  }
}

if (issues.length > 0) {
  console.error('[frontend-authz-nav-parity] Validation failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  console.error(`[frontend-authz-nav-parity] Source: ${relativePath(layoutPath)}`);
  process.exit(1);
}

console.log(
  `[frontend-authz-nav-parity] OK (${adminNavItems.length} Admin nav items, ` +
  `${new Set(adminNavItems.flatMap((item) => item.actionIds)).size} unique action ids).`
);
