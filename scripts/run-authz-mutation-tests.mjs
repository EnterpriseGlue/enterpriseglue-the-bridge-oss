#!/usr/bin/env node

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const evidenceDirectory = path.join(root, 'test/results/engine-tenancy-mutation');
const evidencePath = path.join(evidenceDirectory, 'mutation-report.json');
const commonVitestArgs = [
  '--dir', 'backend', 'exec', 'vitest', 'run',
];
const focusedTests = [
  '__tests__/shared/middleware/requireAction.test.ts',
  '__tests__/shared/middleware/apiClientAuth.test.ts',
  '__tests__/shared/services/platform-admin/engineTenantMappingService.test.ts',
];
const vitestOptions = [
  '--config', 'vitest.config.ts', '--reporter=dot', '--maxWorkers=1', '--no-file-parallelism',
];

function command(commandName, args) {
  return execFileSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function runFocusedTests(label, options = {}) {
  const result = spawnSync('pnpm', [...commonVitestArgs, ...focusedTests, ...vitestOptions], {
    cwd: root,
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: options.quiet ? 'utf8' : undefined,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`${label}: mutation target was not found`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`${label}: mutation target is ambiguous`);
  }
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

const mutants = [
  {
    faultClass: 'deny-bypass',
    name: 'user action deny bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: "if (!allowed) {\n        throw Errors.forbidden(`Access denied for action ${action.actionId}`);\n      }",
    after: "if (false) {\n        throw Errors.forbidden(`Access denied for action ${action.actionId}`);\n      }",
  },
  {
    faultClass: 'deny-bypass',
    name: 'API client deny bypass',
    file: 'packages/shared/src/middleware/apiClientAuth.ts',
    before: "if (!allowed) {\n        throw Errors.forbidden(`API client is not authorized for action: ${actionId}`);\n      }",
    after: "if (false) {\n        throw Errors.forbidden(`API client is not authorized for action: ${actionId}`);\n      }",
  },
  {
    faultClass: 'removed-tenant-filter',
    name: 'tenant visibility filter bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: 'return isTenantVisibleForAuthz(rowTenantId, tenantId);',
    after: 'return true;',
  },
  {
    faultClass: 'accepted-null-tenant-context',
    name: 'null-owned dedicated engine visibility bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: 'return Boolean(engine.tenantId && visibleTenantIds.includes(engine.tenantId));',
    after: 'return !engine.tenantId || visibleTenantIds.includes(engine.tenantId);',
  },
  {
    faultClass: 'upstream-call-after-denial',
    name: 'empty shared inventory early-denial bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: "if (visibleResources && !visibleResources.length) {\n          throw Errors.forbidden('Runtime definition is not present in the authorization inventory');\n        }",
    after: "if (false) {\n          throw Errors.forbidden('Runtime deployment is not present in the authorization inventory');\n        }",
  },
  {
    faultClass: 'partial-batch-deny-bypass',
    name: 'runtime batch partial-permission bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: "const allowed = await Promise.all(resources.map((candidate) => permissionService.hasPermission(action.permissionId, {\n          ...context,\n          resourceType: 'engine_runtime_resource',\n          resourceId: candidate!.id,\n        })));\n        if (allowed.some((candidate) => !candidate)) throw Errors.forbidden(`Access denied for action ${action.actionId}`);",
    after: "const allowed = await Promise.all(resources.map((candidate) => permissionService.hasPermission(action.permissionId, {\n          ...context,\n          resourceType: 'engine_runtime_resource',\n          resourceId: candidate!.id,\n        })));\n        if (false) throw Errors.forbidden(`Access denied for action ${action.actionId}`);",
  },
  {
    faultClass: 'inverted-ownership-check',
    name: 'mapping source ownership bypass',
    file: 'packages/shared/src/services/platform-admin/EngineTenantMappingService.ts',
    before: "existing\n          && (existing.source !== context.source || existing.sourceRef !== item.request.sourceRef)\n          && !allowsConfigWarnOverride",
    after: "existing\n          && (existing.source !== context.source || existing.sourceRef !== item.request.sourceRef)\n          && false",
  },
  {
    faultClass: 'skipped-mapping-version-check',
    name: 'mapping request version bypass',
    file: 'packages/shared/src/services/platform-admin/EngineTenantMappingService.ts',
    before: "requestPayload.expectedMappingVersion !== undefined\n      && requestPayload.expectedMappingVersion !== Number(engine.tenantMappingVersion || 0)",
    after: "false\n      && requestPayload.expectedMappingVersion !== Number(engine.tenantMappingVersion || 0)",
  },
  {
    faultClass: 'skipped-mapping-version-check',
    name: 'mapping transaction version bypass',
    file: 'packages/shared/src/services/platform-admin/EngineTenantMappingService.ts',
    before: "if (Number(lockedEngine.tenantMappingVersion || 0) !== Number(engine.tenantMappingVersion || 0)) {",
    after: "if (false) {",
  },
];

if ((runFocusedTests('baseline').status ?? 1) !== 0) {
  throw new Error('Authorization mutation guard requires a passing focused baseline.');
}

const results = [];
for (const mutant of mutants) {
  const filePath = path.join(root, mutant.file);
  const original = readFileSync(filePath, 'utf8');
  try {
    writeFileSync(filePath, replaceOnce(original, mutant.before, mutant.after, mutant.name));
    const result = runFocusedTests(mutant.name, { quiet: true });
    if ((result.status ?? 1) === 0) {
      throw new Error(`Authorization mutant survived: ${mutant.name}`);
    }
    console.log(`[authz-mutation] killed: ${mutant.name}`);
    results.push({
      name: mutant.name,
      faultClass: mutant.faultClass,
      file: mutant.file,
      result: 'killed',
    });
  } finally {
    writeFileSync(filePath, original);
  }
}

rmSync(evidenceDirectory, { recursive: true, force: true });
mkdirSync(evidenceDirectory, { recursive: true });
const commit = command('git', ['rev-parse', 'HEAD']);
const trackedChanges = command('git', ['status', '--porcelain', '--untracked-files=no']);
writeFileSync(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-targeted-mutation',
  coverageScope: 'security-critical-targeted-mutants',
  status: 'passed',
  generatedAt: new Date().toISOString(),
  commit,
  sourceState: trackedChanges ? 'dirty' : 'clean',
  releaseCommitQualified: trackedChanges.length === 0,
  killed: results.length,
  total: mutants.length,
  faultClasses: Array.from(new Set(results.map((result) => result.faultClass))).sort(),
  results,
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
}, null, 2)}\n`);

console.log(`[authz-mutation] ${mutants.length}/${mutants.length} targeted authorization mutants killed.`);
console.log(`[authz-mutation] evidence: ${path.relative(root, evidencePath)}`);
