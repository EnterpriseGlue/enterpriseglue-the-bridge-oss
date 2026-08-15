import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('identity provisioning OpenAPI contracts', () => {
  it('publishes administrative provisioning contracts without bearer material', () => {
    const document = generateOpenApi();
    const paths = document.paths;
    const list = paths?.['/api/identity/provisioning-directories']?.get;
    const create = paths?.['/api/identity/provisioning-directories']?.post;
    const rotate = paths?.['/api/identity/provisioning-directories/{key}/credentials/{credentialId}/rotate']?.post;
    const credentialCreate = paths?.['/api/identity/provisioning-directories/{key}/credentials']?.post;
    const record = list?.responses?.['200']?.content?.['application/json']?.schema?.properties?.items?.items;

    expect(list?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'platform.sso.providers.read' });
    expect(create?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'platform.sso.providers.manage' });
    expect(rotate?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'platform.sso.providers.manage' });
    expect(record?.properties).toMatchObject({
      key: expect.any(Object),
      status: expect.objectContaining({ enum: ['active', 'disabled', 'archived'] }),
      credentialSecretRef: expect.any(Object),
    });
    expect(record?.properties).not.toHaveProperty('token');
    expect(record?.properties).not.toHaveProperty('tokenHash');
    expect(create?.requestBody?.content?.['application/json']?.schema?.properties).not.toHaveProperty('credentialSecretRef');
    expect(credentialCreate?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'header', name: 'idempotency-key' }),
    ]));
    expect(credentialCreate?.responses?.['201']?.headers?.['Cache-Control']).toBeDefined();
    expect(credentialCreate?.responses?.['409']).toBeDefined();
  });

  it('publishes SCIM discovery and resource endpoints under independent bearer security', () => {
    const document = generateOpenApi();
    expect(document.components?.securitySchemes?.ScimBearer).toMatchObject({ type: 'http', scheme: 'bearer' });

    const users = document.paths?.['/scim/v2/{directoryKey}/Users'];
    const user = document.paths?.['/scim/v2/{directoryKey}/Users/{id}'];
    const groups = document.paths?.['/scim/v2/{directoryKey}/Groups'];
    const discovery = document.paths?.['/scim/v2/{directoryKey}/ServiceProviderConfig']?.get;
    for (const operation of [users?.get, users?.post, user?.get, user?.put, user?.patch, user?.delete, groups?.get, groups?.post, discovery]) {
      expect(operation?.security).toEqual([{ ScimBearer: [] }]);
    }
    expect(users?.post?.requestBody?.content?.['application/scim+json']?.schema).toBeDefined();
    expect(users?.get?.responses?.['200']?.content?.['application/scim+json']?.schema?.properties?.Resources).toBeDefined();
    expect(user?.patch?.responses?.['412']).toBeDefined();
    expect(user?.delete?.responses?.['204']).toBeDefined();
  });

  it('includes provisioning directories in the headless configuration file contract', () => {
    const request = generateOpenApi().paths?.['/api/authz/config-bundles/preview']?.post
      ?.requestBody?.content?.['application/json']?.schema;
    const files = request?.properties?.files;
    expect(files?.properties?.['./identity-provisioning-directories.json']).toBeDefined();
    const item = files?.properties?.['./identity-provisioning-directories.json']
      ?.properties?.identityProvisioningDirectories?.items;
    expect(item?.properties).toMatchObject({
      key: expect.any(Object),
      enabled: expect.any(Object),
      credentialSecretRef: expect.any(Object),
      ownershipMode: expect.any(Object),
    });
  });
});
