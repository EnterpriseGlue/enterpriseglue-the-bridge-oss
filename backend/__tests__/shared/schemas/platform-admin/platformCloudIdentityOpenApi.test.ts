import { describe, expect, it } from 'vitest';

import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('platform Cloud identity OpenAPI', () => {
  it('publishes the strict exchange schemas, exact action authorization, and mutation fence', () => {
    const document = generateOpenApi() as any;
    const exchange = document.paths?.['/api/platform/cloud-identity']?.post;
    const requestSchema = exchange?.requestBody?.content?.['application/json']?.schema;
    const responseSchema = exchange?.responses?.['200']?.content?.['application/json']?.schema;

    expect(exchange?.['x-enterpriseglue-authz']).toMatchObject({
      actionId: 'platform.tenants.read',
      permission: 'platform:tenants:view',
      resourceResolver: 'platform.self',
      additionalChecks: ['Request action must equal platform.tenants.read'],
    });
    expect(requestSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: { action: { enum: ['platform.tenants.read', 'platform.tenants.manage'] } },
    });
    expect(responseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['token', 'expiresIn', 'action'],
      properties: { expiresIn: { enum: [90] } },
    });
    expect(document.components.schemas.PlatformCloudIdentityClaims).toMatchObject({ type: 'object' });
    expect(exchange.responses).toHaveProperty('403');
    expect(exchange.responses).toHaveProperty('503');
    expect(document.paths['/api/platform/tenants'].get.responses).not.toHaveProperty('503');
    expect(document.paths['/api/platform/tenants'].post.responses).toHaveProperty('503');
    expect(document.paths['/api/platform/tenants/{tenantId}'].patch.responses).toHaveProperty('503');
  });
});
