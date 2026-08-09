#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { generateOpenApi } from '../packages/shared/dist/schemas/openapi.js';
import { scanBackendAuthzRoutes } from '../packages/shared/dist/authz/backend-route-scanner.js';
import { validateAuthzRouteInventory } from '../packages/shared/dist/authz/route-inventory.js';

const requireOpenApiForActionRoutes = process.argv.includes('--strict-action-routes');
const requireAuthzClassificationForOpenApiOperations = process.argv.includes('--strict-openapi-classification');
const strictBackendRoutes = process.argv.includes('--strict-backend-routes');
const result = validateAuthzRouteInventory(generateOpenApi(), {
  requireOpenApiForActionRoutes,
  requireAuthzClassificationForOpenApiOperations,
});

function readTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativePath(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

if (!result.valid) {
  console.error('[authz-route-inventory] Validation failed:');
  for (const issue of result.issues) {
    const route = issue.route || issue.openApiPath || '';
    const method = issue.method || '';
    const action = issue.actionId ? ` action=${issue.actionId}` : '';
    console.error(`- ${issue.code}: ${method} ${route}${action} - ${issue.message}`);
    if (issue.field) {
      console.error(`  field=${issue.field} expected=${JSON.stringify(issue.expected)} actual=${JSON.stringify(issue.actual)}`);
    }
  }
  process.exit(1);
}

console.log(`[authz-route-inventory] OK (${requireOpenApiForActionRoutes ? 'strict action routes' : 'migrated routes'}, ${requireAuthzClassificationForOpenApiOperations ? 'strict OpenAPI classification' : 'partial OpenAPI classification'})`);

const backendSourceDir = path.join(process.cwd(), 'packages', 'backend-host', 'src');
const sources = readTsFiles(backendSourceDir).map((filePath) => ({
  filePath: relativePath(filePath),
  content: fs.readFileSync(filePath, 'utf8'),
}));
const scan = scanBackendAuthzRoutes(sources);
const routeCoverage = scan.authenticatedRoutes.length === 0
  ? 100
  : Math.round((scan.coveredAuthenticatedRoutes.length / scan.authenticatedRoutes.length) * 1000) / 10;

console.log(
  `[authz-backend-route-scan] ${scan.coveredAuthenticatedRoutes.length}/${scan.authenticatedRoutes.length} ` +
  `authenticated routes covered (${routeCoverage}%). ${scan.registeredAuthenticatedRoutes.length} action-registered, ` +
  `${scan.exemptAuthenticatedRoutes.length} exempt, ${scan.uncoveredAuthenticatedRoutes.length} remaining.`
);

const maxPreview = 20;
for (const route of scan.uncoveredAuthenticatedRoutes.slice(0, maxPreview)) {
  console.log(`[authz-backend-route-scan] uncovered ${route.method} ${route.route} (${route.filePath}:${route.line})`);
}
if (scan.uncoveredAuthenticatedRoutes.length > maxPreview) {
  console.log(`[authz-backend-route-scan] ... ${scan.uncoveredAuthenticatedRoutes.length - maxPreview} more uncovered authenticated routes`);
}

if (strictBackendRoutes && scan.uncoveredAuthenticatedRoutes.length > 0) {
  console.error('[authz-backend-route-scan] Strict backend route mode failed');
  process.exit(1);
}
