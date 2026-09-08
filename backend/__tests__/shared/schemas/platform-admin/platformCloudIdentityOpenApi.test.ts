import { describe, expect, it } from 'vitest';

import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { AuthzOpenApiClassificationSchema, AuthzOpenApiExtensionSchema } from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import type { AuthzOpenApiExtension } from '@enterpriseglue/shared/authz/permission-actions.js';

describe('platform Cloud identity OpenAPI', () => {
  it('publishes the strict exchange schemas, exact action authorization, and mutation fence', () => {
    const document = generateOpenApi() as any;
    const exchange = document.paths?.['/api/platform/cloud-identity']?.post;
    const requestSchema = exchange?.requestBody?.content?.['application/json']?.schema;
    const responseSchema = exchange?.responses?.['200']?.content?.['application/json']?.schema;

    const authz = AuthzOpenApiClassificationSchema.parse(exchange?.['x-enterpriseglue-authz']);
    expect(authz).toEqual({
      mode: 'request-action',
      selector: { location: 'body', field: 'action' },
      alternatives: [
        {
          value: 'platform.tenants.self_create',
          actionId: 'platform.tenants.self_create',
          permission: 'platform:tenants:self-create',
          resourceResolver: 'platform.self',
          additionalChecks: ['Request action must equal platform.tenants.self_create'],
          risk: 'critical',
          audit: true,
          uiBehavior: 'disable',
        },
        {
          value: 'platform.tenants.read',
          actionId: 'platform.tenants.read',
          permission: 'platform:tenants:view',
          resourceResolver: 'platform.self',
          additionalChecks: ['Request action must equal platform.tenants.read'],
          risk: 'high',
          audit: false,
          uiBehavior: 'hide',
        },
        {
          value: 'platform.tenants.manage',
          actionId: 'platform.tenants.manage',
          permission: 'platform:tenants:manage',
          resourceResolver: 'platform.self',
          additionalChecks: ['Request action must equal platform.tenants.manage'],
          risk: 'critical',
          audit: true,
          uiBehavior: 'disable',
        },
      ],
    });
    expect(requestSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: { action: { enum: ['platform.tenants.self_create', 'platform.tenants.read', 'platform.tenants.manage'] } },
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

  it('preserves the static extension type and parser for existing consumers', () => {
    const legacy: AuthzOpenApiExtension = {
      actionId: 'platform.tenants.read', permission: 'platform:tenants:view',
      resourceResolver: 'platform.self', additionalChecks: [], risk: 'high',
      audit: false, uiBehavior: 'hide',
    };
    const actionId: string = legacy.actionId;
    const parsed = AuthzOpenApiExtensionSchema.parse(legacy);
    const permission: string = parsed.permission;
    expect(actionId).toBe('platform.tenants.read');
    expect(permission).toBe('platform:tenants:view');
    expect(AuthzOpenApiClassificationSchema.parse(legacy)).toEqual(parsed);
  });
});
