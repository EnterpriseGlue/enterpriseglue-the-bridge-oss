import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { CreateEngineRequestSchema } from '@enterpriseglue/shared/schemas/mission-control/engine.js';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const adapterReference = readFileSync(
  resolve(repoRoot, 'docs/reference/customer-sidecar-backstop-adapter-api.md'),
  'utf8',
);
const engineApiReference = readFileSync(
  resolve(repoRoot, 'docs/reference/engine-tenancy-and-provisioning-api.md'),
  'utf8',
);
const documentationIndex = readFileSync(resolve(repoRoot, 'docs/index.md'), 'utf8');

describe('customer-sidecar backstop API documentation contracts', () => {
  it('publishes the bounded v1 customer-sidecar adapter contract', () => {
    for (const requiredText of [
      'Customer Sidecar Backstop Adapter API (v1)',
      '/engine-rest/authorization/create',
      '/engine-rest/authorization/{authorizationId}',
      'X-EnterpriseGlue-Operation-Class: engine.native_authorization.backstop',
      'strip the inbound',
      'sanitized',
      'does **not** retry the request through a direct engine',
      'customer-sidecar-reference.mjs',
      'test:operaton-sidecar-backstop-container',
    ]) {
      expect(adapterReference).toContain(requiredText);
    }
    expect(engineApiReference).toContain('Customer-sidecar Registration API');
    expect(engineApiReference).toContain('./customer-sidecar-backstop-adapter-api.md');
    expect(documentationIndex).toContain('reference/customer-sidecar-backstop-adapter-api.md');
  });

  it('keeps public OpenAPI registration and lifecycle descriptions aligned with the sidecar boundary', () => {
    const document = generateOpenApi();
    const registration = document.paths?.['/engines-api/engines']?.post;
    const externalRegistration = document.paths?.['/engines-api/external/engines']?.post;
    const update = document.paths?.['/engines-api/engines/{id}']?.put;

    for (const operation of [registration, externalRegistration, update]) {
      expect(operation?.description).toContain('customer-owned sidecar');
      expect(operation?.description).toContain('downstream engine credential');
    }

    const example = registration?.requestBody?.content?.['application/json']?.example;
    const parsed = CreateEngineRequestSchema.safeParse(example);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(parsed.data).toMatchObject({
      connectionMode: 'customer_sidecar',
      baseUrl: expect.stringContaining('/engine-rest'),
      passwordEnc: expect.stringMatching(/^ref:(?:env|file|docker):\/\//),
    });

    for (const [path, method] of [
      ['/engines-api/engines/{id}/backstop/status', 'get'],
      ['/engines-api/engines/{id}/backstop/mappings', 'post'],
      ['/engines-api/engines/{id}/backstop/sync/preview', 'post'],
      ['/engines-api/engines/{id}/backstop/sync', 'get'],
      ['/engines-api/engines/{id}/backstop/sync/{runId}', 'get'],
      ['/engines-api/engines/{id}/backstop/sync/{runId}/detail', 'get'],
      ['/engines-api/engines/{id}/backstop/sync/{runId}/apply', 'post'],
      ['/engines-api/engines/{id}/backstop/sync/{runId}/drift-check', 'post'],
      ['/engines-api/engines/{id}/backstop/sync/{runId}/rollback', 'post'],
    ] as const) {
      const operation = document.paths?.[path]?.[method];
      expect(operation?.description).toContain('fails closed');
      expect(operation?.description).toContain('never falls back to a direct-engine endpoint');
    }
  });

  it('publishes explicit protected-detail and durable-task response contracts', () => {
    const paths = generateOpenApi().paths;
    const detailSchema = paths?.['/engines-api/engines/{id}/backstop/sync/{runId}/detail']
      ?.get?.responses?.['200']?.content?.['application/json']?.schema;

    expect(detailSchema).toMatchObject({
      type: 'object',
      required: ['run', 'detail'],
      additionalProperties: false,
      properties: {
        run: {
          type: 'object',
          properties: expect.objectContaining({
            id: expect.any(Object),
            status: expect.any(Object),
          }),
        },
        detail: {
          anyOf: expect.arrayContaining([
            expect.objectContaining({
              required: ['version', 'projection'],
              additionalProperties: false,
            }),
            expect.objectContaining({
              required: ['version', 'rollbackOfRunId', 'ownedGrants'],
              additionalProperties: false,
            }),
            expect.objectContaining({
              required: ['version', 'observedOfRunId', 'projection', 'ownedGrants'],
              additionalProperties: false,
            }),
          ]),
        },
      },
    });

    for (const suffix of ['apply', 'rollback', 'drift-check']) {
      const operationSchema = paths?.[`/engines-api/engines/{id}/backstop/sync/{runId}/${suffix}`]
        ?.post?.responses?.['200']?.content?.['application/json']?.schema;
      expect(operationSchema).toMatchObject({
        type: 'object',
        required: ['run', 'task'],
        additionalProperties: false,
        properties: {
          task: {
            type: 'object',
            nullable: true,
            required: ['taskId', 'runId', 'operation', 'status', 'attempts', 'nextAttemptAt', 'lastError'],
            additionalProperties: false,
            properties: expect.objectContaining({
              operation: { type: 'string', enum: ['apply', 'rollback', 'drift_check'] },
              status: { type: 'string', enum: ['queued', 'running', 'completed'] },
              attempts: { type: 'integer', minimum: 0 },
            }),
          },
        },
      });
    }
  });
});
