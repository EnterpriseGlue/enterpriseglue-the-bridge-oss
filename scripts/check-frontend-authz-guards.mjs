#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoots = [
  'packages/frontend-host/src',
  'frontend/src',
];

const legacyCapabilityKeys = [
  'canViewAdminMenu',
  'canAccessAdminRoutes',
  'canManageUsers',
  'canViewAuditLogs',
  'canManagePlatformSettings',
  'canViewMissionControl',
  'canManageTenants',
  'canManagePlatformEmail',
  'canManageSsoProviders',
  'canManagePlatformBranding',
  'canManageTenantDomains',
  'canManageTenantUsers',
  'canManageTenantBranding',
  'canManageTenantEmailTemplates',
  'canViewTenantAudit',
  'canManageTenantSso',
  'canManageProject',
  'canManageEngine',
  'canInviteProjectMembers',
  'canInviteEngineMembers',
];

const legacyRoleValues = [
  'admin',
  'developer',
  'user',
  'owner',
  'delegate',
  'operator',
  'deployer',
  'editor',
  'viewer',
];

const forbiddenPatterns = [
  {
    id: 'legacy-capability-key',
    pattern: new RegExp(`\\b(?:${legacyCapabilityKeys.join('|')})\\b`, 'g'),
  },
  {
    id: 'platform-role-field',
    pattern: /\bplatformRole\b/g,
  },
  {
    id: 'legacy-role-equality',
    pattern: new RegExp(
      `\\b(?:role|platformRole|member\\.role|membership\\.role|user\\.platformRole|currentUser\\.platformRole)\\s*` +
      `(?:===|!==|==|!=)\\s*['"](?:${legacyRoleValues.join('|')})['"]`,
      'g'
    ),
  },
  {
    id: 'legacy-role-includes',
    pattern: new RegExp(`\\broles?\\.includes\\(['"](?:${legacyRoleValues.join('|')})['"]\\)`, 'g'),
  },
  {
    id: 'user-capabilities-property',
    pattern: /\buser\.capabilities\b|\bcapabilities\?\.\[/g,
  },
];

// Maximum current legacy-auth pattern counts by rule. Keep this empty unless a
// deliberate temporary compatibility field is approved with a removal plan.
const toleratedMatchesByFile = new Map();

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
  const matches = [];

  for (const rule of forbiddenPatterns) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const location = lineAndColumn(content, match.index || 0);
      matches.push({
        rule: rule.id,
        text: match[0],
        line: location.line,
        column: location.column,
      });
    }
  }

  return matches;
}

function countMatchesByRule(matches) {
  const counts = new Map();
  for (const match of matches) {
    counts.set(match.rule, (counts.get(match.rule) || 0) + 1);
  }
  return counts;
}

const files = sourceRoots
  .flatMap((sourceRoot) => walkFiles(path.join(repoRoot, sourceRoot)))
  .sort((a, b) => a.localeCompare(b));

const issues = [];
let totalMatches = 0;

for (const filePath of files) {
  const rel = relativePath(filePath);
  const matches = scanFile(filePath);
  if (matches.length === 0) continue;

  totalMatches += matches.length;
  const tolerated = toleratedMatchesByFile.get(rel) || {};
  const countsByRule = countMatchesByRule(matches);
  const overBaselineRules = [];
  for (const [rule, count] of countsByRule) {
    const ruleLimit = tolerated[rule] || 0;
    if (count > ruleLimit) {
      overBaselineRules.push({ rule, count, tolerated: ruleLimit });
    }
  }
  if (overBaselineRules.length === 0) continue;

  issues.push({
    filePath: rel,
    overBaselineRules,
    matches,
  });
}

if (issues.length > 0) {
  console.error('[frontend-authz-guards] Hard-coded role/capability checks exceeded the compatibility baseline.');
  console.error('[frontend-authz-guards] Use action decisions, permission snapshots, or shared guard helpers instead.');
  for (const issue of issues) {
    const summary = issue.overBaselineRules
      .map((item) => `${item.rule} ${item.count}/${item.tolerated}`)
      .join(', ');
    console.error(`- ${issue.filePath}: ${summary}`);
    for (const match of issue.matches.filter((entry) =>
      issue.overBaselineRules.some((rule) => rule.rule === entry.rule)
    ).slice(0, 10)) {
      console.error(`  ${match.line}:${match.column} ${match.rule} ${JSON.stringify(match.text)}`);
    }
  }
  process.exit(1);
}

console.log(`[frontend-authz-guards] OK (${totalMatches} legacy compatibility matches within baseline)`);
