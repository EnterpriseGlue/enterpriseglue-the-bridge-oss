import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  CreateEngineRequestSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  ExternalEngineDecommissionRequestSchema,
  ExternalEngineRegistrationRequestSchema,
  ExternalEngineTenantMappingsUpsertRequestSchema,
  UpdateEngineRequestSchema,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const DOCUMENTS = [
  'docs/architecture/decisions/0001-default-tenant-provisioning-fallback.md',
  'docs/architecture/decisions/0002-shared-engine-fail-closed-resolution.md',
  'docs/architecture/09-oss-authorization-access-control-model.md',
  'docs/architecture/11-json-driven-authz-and-engine-registration.md',
  'docs/how-to/configure-authorization-and-engines.md',
  'docs/how-to/configure-engine-tenancy.md',
  'docs/how-to/deploy-authorization-config.md',
  'docs/how-to/deployment-runbook.md',
  'docs/how-to/diagnose-engine-tenant-resolution.md',
  'docs/how-to/migrate-existing-engines-to-explicit-tenancy.md',
  'docs/how-to/provision-engines-externally.md',
  'docs/how-to/upgrade-engine-tenancy.md',
  'docs/reference/engine-tenancy-and-provisioning-api.md',
  'docs/reference/engine-tenancy-compatibility-and-deprecation.md',
  'docs/reference/engine-tenancy-data-model.md',
  'docs/reference/configuration-matrix.md',
  'docs/reference/database-architecture.md',
  'docs/reference/observability-logs.md',
  'docs/reference/security-hardening.md',
  'docs/releases/engine-tenancy.md',
  'docs/development/engine-tenancy-documentation-review-checklist.md',
  'docs/development/engine-tenancy-functional-test-report.md',
  'docs/development/testing-engine-tenancy-and-access-control.md',
];
const CURL_DOCUMENTS = [
  'docs/how-to/diagnose-engine-tenant-resolution.md',
  'docs/how-to/migrate-existing-engines-to-explicit-tenancy.md',
  'docs/how-to/provision-engines-externally.md',
  'docs/reference/engine-tenancy-and-provisioning-api.md',
];
const SCHEMAS: Record<string, z.ZodType> = {
  CreateEngineRequestSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionPreviewRequestSchema,
  ExternalEngineDecommissionRequestSchema,
  ExternalEngineRegistrationRequestSchema,
  ExternalEngineTenantMappingsUpsertRequestSchema,
  UpdateEngineRequestSchema,
};
const EXPECTED_OPERATIONS = new Set([
  'GET /metrics',
  'POST /engines-api/engines',
  'PUT /engines-api/engines/{id}',
  'DELETE /engines-api/engines/{id}',
  'POST /engines-api/external/engines',
  'PUT /engines-api/external/engines/{externalId}/tenant-mappings',
  'POST /engines-api/external/engines/decommission',
  'GET /engines-api/engines/tenancy/classification-report',
  'GET /engines-api/engines/{id}/tenancy/diagnostics',
  'POST /engines-api/engines/{id}/tenancy/preview',
  'POST /engines-api/engines/{id}/tenancy/apply',
  'GET /engines-api/engines/{id}/tenant-mappings',
  'PUT /engines-api/engines/{id}/tenant-mappings',
  'GET /engines-api/engines/{id}/runtime-resources',
  'POST /engines-api/engines/{id}/runtime-resources/reconcile',
  'POST /api/authz/external-engines/{id}/reconcile',
]);
const curlContract = /<!--\s*enterpriseglue-curl-contract:\s*(GET|POST|PUT|DELETE)\s+(\S+)\s+([A-Za-z0-9_-]+)\s*-->\s*```bash\s*\n([\s\S]*?)\n```/g;
const bashFence = /```bash\s*\n([\s\S]*?)\n```/g;

function requestPath(block: string): string {
  const match = block.match(/\$ENTERPRISEGLUE_URL([^"'\\\s]+)/);
  if (!match) throw new Error('curl example must use $ENTERPRISEGLUE_URL');
  return match[1].replace(/\?.*$/, '');
}

function pathMatchesTemplate(path: string, template: string): boolean {
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');
  return new RegExp(`^${pattern}$`).test(path);
}

function requestBody(block: string): unknown {
  const match = block.match(/--data\s+'([\s\S]*?)'/);
  if (!match) throw new Error('body-bearing curl example must use a single-quoted --data JSON object');
  return JSON.parse(match[1]);
}

function markdownAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of markdown.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = match[1]
      .replace(/[`*_~]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const occurrence = counts.get(base) || 0;
    counts.set(base, occurrence + 1);
    anchors.add(occurrence === 0 ? base : `${base}-${occurrence}`);
  }
  return anchors;
}

describe('engine tenancy documentation contracts', () => {
  it('validates every published curl example against OpenAPI and its runtime request schema', () => {
    const openApi = generateOpenApi();
    const covered = new Set<string>();

    for (const documentPath of CURL_DOCUMENTS) {
      const markdown = readFileSync(resolve(repoRoot, documentPath), 'utf8');
      const curlBlocks = [...markdown.matchAll(bashFence)]
        .map((match) => match[1])
        .filter((block) => /\bcurl\b/.test(block));
      const contracts = [...markdown.matchAll(curlContract)];
      expect(contracts, `${documentPath}: every curl block must have a contract annotation`)
        .toHaveLength(curlBlocks.length);

      for (const [, method, pathTemplate, schemaName, block] of contracts) {
        const operation = openApi.paths?.[pathTemplate]?.[method.toLowerCase()];
        expect(operation, `${method} ${pathTemplate} must exist in OpenAPI`).toBeDefined();
        expect(block.match(/-X\s+(GET|POST|PUT|DELETE)/)?.[1] || 'GET').toBe(method);
        expect(
          pathMatchesTemplate(requestPath(block), pathTemplate),
          `${documentPath}: curl URL must match ${pathTemplate}`,
        ).toBe(true);
        expect(block).toMatch(/Authorization: Bearer \$ENTERPRISEGLUE_(?:TOKEN|ADMIN_TOKEN)|\/metrics/);

        if (schemaName === 'none') {
          expect(block).not.toContain('--data');
        } else {
          const schema = SCHEMAS[schemaName];
          expect(schema, `${documentPath}: unknown request schema ${schemaName}`).toBeDefined();
          const parsed = schema.safeParse(requestBody(block));
          expect(
            parsed.success,
            parsed.success ? undefined : `${documentPath}: ${JSON.stringify(parsed.error.issues, null, 2)}`,
          ).toBe(true);
        }

        expect(block).not.toMatch(/Authorization: Bearer (?!\$ENTERPRISEGLUE_)[^"'\s]+/);
        for (const value of JSON.stringify(schemaName === 'none' ? {} : requestBody(block))
          .matchAll(/"(?:passwordEnc|token|secret)"\s*:\s*"([^"]+)"/g)) {
          expect(value[1], `${documentPath}: credential examples must use opaque refs`)
            .toMatch(/^ref:(?:env|file|docker):\/\//);
        }
        covered.add(`${method} ${pathTemplate}`);
      }
    }

    expect(covered).toEqual(EXPECTED_OPERATIONS);
  });

  it('keeps feature documentation links, anchors, and index navigation valid', () => {
    for (const documentPath of DOCUMENTS) {
      const absolutePath = resolve(repoRoot, documentPath);
      const markdown = readFileSync(absolutePath, 'utf8');
      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:)/.test(target)) continue;
        const [relativePath, anchor] = target.split('#');
        const targetPath = relativePath
          ? resolve(dirname(absolutePath), decodeURIComponent(relativePath))
          : absolutePath;
        expect(existsSync(targetPath), `${documentPath}: missing link target ${target}`).toBe(true);
        if (anchor) {
          const targetMarkdown = readFileSync(targetPath, 'utf8');
          expect(
            markdownAnchors(targetMarkdown).has(decodeURIComponent(anchor)),
            `${documentPath}: missing anchor ${target}`,
          ).toBe(true);
        }
      }
    }

    const index = readFileSync(resolve(repoRoot, 'docs/index.md'), 'utf8');
    for (const documentPath of DOCUMENTS.filter((path) => path !== 'docs/index.md')) {
      expect(index, `docs/index.md must link ${documentPath}`)
        .toContain(documentPath.replace(/^docs\//, ''));
    }
  });

  it('keeps the executable 100 percent coverage contract aligned across developer and user Markdown', () => {
    const plan = readFileSync(
      resolve(repoRoot, 'docs/architecture/12-engine-tenancy-and-external-provisioning-plan.md'),
      'utf8',
    );
    const testingGuide = readFileSync(
      resolve(repoRoot, 'docs/development/testing-engine-tenancy-and-access-control.md'),
      'utf8',
    );
    const userGuide = readFileSync(
      resolve(repoRoot, 'docs/how-to/configure-engine-tenancy.md'),
      'utf8',
    );
    const reviewChecklist = readFileSync(
      resolve(repoRoot, 'docs/development/engine-tenancy-documentation-review-checklist.md'),
      'utf8',
    );

    for (const requiredContract of [
      'Exhaustive authorization state-space',
      'applicability registry',
      'independent expectation model',
      'unknown, missing, skipped, quarantined',
      'Documentation tests',
      'End-to-End Definition of Done',
    ]) {
      expect(plan).toContain(requiredContract);
    }
    for (const requiredContract of [
      'constraint-generated',
      'stable invalidity ID',
      'executed applicable cells / applicable cells = 100%',
      'missing = skipped = quarantined = unknown = unexpected = 0',
      'browser-accessibility.json',
      'compatibility-window.json',
    ]) {
      expect(testingGuide).toContain(requiredContract);
    }
    expect(userGuide).toContain('### Production Enablement Checklist');
    expect(userGuide).toContain('decentralized installation');
    expect(userGuide).toContain('centralized installation');
    expect(reviewChecklist).toContain(
      '../how-to/configure-engine-tenancy.md#production-enablement-checklist',
    );
    expect(reviewChecklist).toContain('authorization-matrix.json');
  });

  it('requires explicit tenancy for external registration without a compatibility warning', () => {
    const compatibilityGuide = readFileSync(
      resolve(repoRoot, 'docs/reference/engine-tenancy-compatibility-and-deprecation.md'),
      'utf8',
    );
    const upgradeGuide = readFileSync(
      resolve(repoRoot, 'docs/how-to/upgrade-engine-tenancy.md'),
      'utf8',
    );
    const releaseNotes = readFileSync(
      resolve(repoRoot, 'docs/releases/engine-tenancy.md'),
      'utf8',
    );
    const openApi = generateOpenApi();
    const manualCreate = openApi.paths?.['/engines-api/engines']?.post;
    const externalCreate = openApi.paths?.['/engines-api/external/engines']?.post;

    for (const document of [compatibilityGuide, upgradeGuide, releaseNotes]) {
      expect(document).toContain('explicit tenancy');
      expect(document).toContain('rejected');
    }
    expect(JSON.stringify(manualCreate?.responses?.[201])).not.toContain('ENGINE_TENANCY_DEFAULTED_TO_DEDICATED');
    expect(JSON.stringify(externalCreate?.responses?.[201])).not.toContain('ENGINE_TENANCY_DEFAULTED_TO_DEDICATED');
    expect(JSON.stringify(externalCreate?.requestBody)).toContain('tenancy');
  });
});
