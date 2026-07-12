#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoot = 'packages/backend-host/src/modules';
const sharedMiddlewareRoleFallbackFiles = [
  'packages/shared/src/middleware/authorize.ts',
  'packages/shared/src/interfaces/middleware/authorize.ts',
  'packages/shared/src/middleware/projectAuth.ts',
  'packages/shared/src/interfaces/middleware/projectAuth.ts',
  'packages/shared/src/middleware/engineAuth.ts',
  'packages/shared/src/interfaces/middleware/engineAuth.ts',
  'packages/shared/src/middleware/platformAuth.ts',
  'packages/shared/src/interfaces/middleware/platformAuth.ts',
  'packages/shared/src/middleware/deployAuth.ts',
  'packages/shared/src/interfaces/middleware/deployAuth.ts',
  'packages/shared/src/middleware/requireAction.ts',
  'packages/shared/src/interfaces/middleware/requireAction.ts',
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
    id: 'project-member-has-role',
    pattern: /\bprojectMemberService\.hasRole\s*\(/g,
  },
  {
    id: 'project-member-has-access',
    pattern: /\bprojectMemberService\.hasAccess\s*\(/g,
  },
  {
    id: 'authorization-service-file-access',
    pattern: /\bAuthorizationService\.verifyFileAccess\s*\(/g,
  },
  {
    id: 'engine-access-role-list',
    pattern: /\bengineService\.hasEngineAccess\s*\([^\n]+\broles\b/g,
  },
  {
    id: 'engine-access-array-role-list',
    pattern: /\bengineService\.hasEngineAccess\s*\([^)]*\[[^\]]*['"](?:owner|delegate|operator|deployer)['"][^\]]*\]/gs,
  },
  {
    id: 'allowed-roles-includes',
    pattern: /\ballowedRoles\.includes\s*\(/g,
  },
  {
    id: 'authorize-role-includes',
    pattern: /\boptions\.(?:platformRoles|projectRoles|engineRoles)\.includes\s*\(/g,
  },
  {
    id: 'platform-role-comparison',
    pattern: /\bplatformRole\b\s*(?:===|!==|==|!=)\s*['"](?:admin|developer|user)['"]/g,
  },
  {
    id: 'user-role-comparison',
    pattern: new RegExp(
      `\\b(?:user|req\\.user|targetMembership|entry|role)\\??\\.?role\\b\\s*` +
      `(?:===|!==|==|!=)\\s*['"](?:${legacyRoleValues.join('|')})['"]`,
      'g'
    ),
  },
];

// Maximum current route-local legacy-auth pattern counts by rule. New files must
// have zero matches and existing files may only reduce these counts unless the
// baseline is deliberately updated during a migration step.
const toleratedMatchesByFile = new Map(Object.entries({
}));

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
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

const files = Array.from(new Set([
  ...walkFiles(path.join(repoRoot, sourceRoot)),
  ...sharedMiddlewareRoleFallbackFiles
    .map((filePath) => path.join(repoRoot, filePath))
    .filter((filePath) => fs.existsSync(filePath)),
])).sort((a, b) => a.localeCompare(b));

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
  console.error('[backend-authz-guards] Backend route or shared middleware role checks exceeded the compatibility baseline.');
  console.error('[backend-authz-guards] Use requireAction, requireCompositeAction, or the shared evaluator instead.');
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

console.log(`[backend-authz-guards] OK (${totalMatches} backend/shared-middleware compatibility matches within baseline)`);
