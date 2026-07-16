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
const sharedAuthorizationServiceFiles = [
  // Project-engine access must be authorized by canonical evaluator decisions;
  // accountable owner/delegate metadata is not an access source.
  'packages/shared/src/services/platform-admin/EngineAccessService.ts',
];
const projectMembershipCommandFiles = [
  'packages/shared/src/services/platform-admin/ProjectMemberService.ts',
  'packages/shared/src/services/starbase/ProjectCreationService.ts',
  'packages/shared/src/services/starbase/ProjectQueryService.ts',
  'packages/backend-host/src/modules/git/routes/clone.ts',
  'packages/backend-host/src/modules/git/routes/createOnline.ts',
  'packages/backend-host/src/modules/starbase/routes/projects.ts',
];
// `source = legacy` is a compatibility boundary, not an authorization-source
// choice available to normal commands. Keep its remaining writers constrained
// to the one-way membership reconciliation and the documented project-engine
// bridge until the deployed cutover evidence permits their retirement.
const legacyAuthorizationSourceWriterAllowlist = new Set([
  'packages/shared/src/services/platform-admin/permissions.ts',
  'packages/shared/src/services/platform-admin/legacy-project-role-assignments.ts',
  'packages/shared/src/services/platform-admin/ProjectEngineTargetService.ts',
]);
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
  {
    id: 'engine-access-accountable-metadata',
    fileSuffix: 'packages/shared/src/services/platform-admin/EngineAccessService.ts',
    pattern: /\b(?:ownerId|delegateId)\b/g,
  },
  {
    id: 'engine-access-project-member-lookup',
    fileSuffix: 'packages/shared/src/services/platform-admin/EngineAccessService.ts',
    pattern: /\bProjectMember\b|\bmemberRepo\b/g,
  },
  {
    id: 'dashboard-context-project-member-lookup',
    fileSuffix: 'packages/backend-host/src/modules/dashboard/routes/context.ts',
    pattern: /\bProjectMember\b|\bprojectMemberRepo\b/g,
  },
  {
    id: 'dashboard-stats-project-member-lookup',
    fileSuffix: 'packages/backend-host/src/modules/dashboard/routes/stats.ts',
    pattern: /\bProjectMember\b|\bprojectMemberRepo\b/g,
  },
  {
    // Compatibility projections are migration-only. Any active project
    // membership command must write the canonical manual assignment instead.
    id: 'project-membership-legacy-assignment-write',
    filePaths: projectMembershipCommandFiles,
    pattern: /\bwriteLegacyProjectMemberRoleAssignments\b/g,
  },
  {
    // Current EngineMember changes must replace historical projections with a
    // normal canonical assignment instead of writing another legacy source.
    id: 'engine-member-legacy-assignment-write',
    fileSuffix: 'packages/shared/src/services/platform-admin/EngineService.ts',
    pattern: /\bwriteLegacyEngineMemberAssignment\b/g,
  },
  {
    id: 'engine-delete-legacy-only-assignment-cleanup',
    fileSuffix: 'packages/backend-host/src/modules/mission-control/engines/routes.ts',
    pattern: /source:\s*'legacy'/g,
  },
  {
    id: 'project-delete-legacy-only-assignment-cleanup',
    fileSuffix: 'packages/backend-host/src/modules/starbase/routes/projects.ts',
    pattern: /source:\s*'legacy'/g,
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
  const rel = relativePath(filePath);

  for (const rule of forbiddenPatterns) {
    if (rule.fileSuffix && rel !== rule.fileSuffix) continue;
    if (rule.filePaths && !rule.filePaths.includes(rel)) continue;
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

function findLegacyAuthorizationSourceWriters() {
  const roots = [
    'packages/shared/src/services',
    'packages/backend-host/src',
  ];
  const matches = [];

  for (const root of roots) {
    for (const filePath of walkFiles(path.join(repoRoot, root))) {
      const rel = relativePath(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(/\bsource\s*:\s*['"]legacy['"]/g)) {
        const location = lineAndColumn(content, match.index || 0);
        matches.push({ filePath: rel, line: location.line, column: location.column, text: match[0] });
      }
    }
  }

  return matches;
}

const files = Array.from(new Set([
  ...walkFiles(path.join(repoRoot, sourceRoot)),
  ...sharedMiddlewareRoleFallbackFiles
    .map((filePath) => path.join(repoRoot, filePath))
    .filter((filePath) => fs.existsSync(filePath)),
  ...sharedAuthorizationServiceFiles
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

const unexpectedLegacySourceWriters = findLegacyAuthorizationSourceWriters()
  .filter((match) => !legacyAuthorizationSourceWriterAllowlist.has(match.filePath));

if (unexpectedLegacySourceWriters.length > 0) {
  issues.push({
    filePath: 'legacy authorization source writers',
    overBaselineRules: [{
      rule: 'unexpected-legacy-source-writer',
      count: unexpectedLegacySourceWriters.length,
      tolerated: 0,
    }],
    matches: unexpectedLegacySourceWriters.map((match) => ({
      rule: 'unexpected-legacy-source-writer',
      text: match.text,
      line: match.line,
      column: match.column,
      filePath: match.filePath,
    })),
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
      console.error(`  ${match.filePath ? `${match.filePath}:` : ''}${match.line}:${match.column} ${match.rule} ${JSON.stringify(match.text)}`);
    }
  }
  process.exit(1);
}

console.log(`[backend-authz-guards] OK (${totalMatches} backend/shared-middleware compatibility matches within baseline)`);
