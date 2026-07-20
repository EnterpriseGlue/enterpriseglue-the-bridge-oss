#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const vitestArgs = [
  '--dir', 'backend', 'exec', 'vitest', 'run',
  '__tests__/shared/middleware/requireAction.test.ts',
  '__tests__/shared/middleware/apiClientAuth.test.ts',
  '--config', 'vitest.config.ts', '--reporter=dot', '--maxWorkers=1', '--no-file-parallelism',
];

function runFocusedTests(label) {
  const result = spawnSync('pnpm', vitestArgs, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.status ?? 1;
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
    name: 'user action deny bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: "if (!allowed) {\n        throw Errors.forbidden(`Access denied for action ${action.actionId}`);\n      }",
    after: "if (false) {\n        throw Errors.forbidden(`Access denied for action ${action.actionId}`);\n      }",
  },
  {
    name: 'API client deny bypass',
    file: 'packages/shared/src/middleware/apiClientAuth.ts',
    before: "if (!allowed) {\n        throw Errors.forbidden(`API client is not authorized for action: ${actionId}`);\n      }",
    after: "if (false) {\n        throw Errors.forbidden(`API client is not authorized for action: ${actionId}`);\n      }",
  },
  {
    name: 'runtime deployment inventory bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: "if (!resources.length || resources.some((candidate) => !isTenantVisible(candidate.tenantId, tenantId))) {\n          throw Errors.forbidden('Runtime deployment is not present in the authorization inventory');\n        }",
    after: "if (false) {\n          throw Errors.forbidden('Runtime deployment is not present in the authorization inventory');\n        }",
  },
  {
    name: 'tenant visibility bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: 'return isTenantVisibleForAuthz(rowTenantId, tenantId);',
    after: 'return true;',
  },
  {
    name: 'runtime batch partial-permission bypass',
    file: 'packages/shared/src/middleware/requireAction.ts',
    before: "const allowed = await Promise.all(resources.map((candidate) => permissionService.hasPermission(action.permissionId, {\n          ...context,\n          resourceType: 'engine_runtime_resource',\n          resourceId: candidate!.id,\n        })));\n        if (allowed.some((candidate) => !candidate)) throw Errors.forbidden(`Access denied for action ${action.actionId}`);",
    after: "const allowed = await Promise.all(resources.map((candidate) => permissionService.hasPermission(action.permissionId, {\n          ...context,\n          resourceType: 'engine_runtime_resource',\n          resourceId: candidate!.id,\n        })));\n        if (false) throw Errors.forbidden(`Access denied for action ${action.actionId}`);",
  },
];

if (runFocusedTests('baseline') !== 0) {
  throw new Error('Authorization mutation guard requires a passing focused baseline.');
}

for (const mutant of mutants) {
  const filePath = path.join(root, mutant.file);
  const original = readFileSync(filePath, 'utf8');
  try {
    writeFileSync(filePath, replaceOnce(original, mutant.before, mutant.after, mutant.name));
    const status = runFocusedTests(mutant.name);
    if (status === 0) {
      throw new Error(`Authorization mutant survived: ${mutant.name}`);
    }
    console.log(`[authz-mutation] killed: ${mutant.name}`);
  } finally {
    writeFileSync(filePath, original);
  }
}

console.log(`[authz-mutation] ${mutants.length}/${mutants.length} targeted authorization mutants killed.`);
