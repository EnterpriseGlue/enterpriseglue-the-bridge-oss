import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('platform user OpenAPI contracts', () => {
  it('publishes the same explicit schemas used by the routes and service', () => {
    const paths = generateOpenApi().paths;
    const listItem = paths?.['/api/users']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema?.items;
    const create = paths?.['/api/users']?.post;
    const detail = paths?.['/api/users/{id}']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema;
    const update = paths?.['/api/users/{id}']?.put;

    expect(listItem?.required).toEqual(expect.arrayContaining([
      'id', 'email', 'platformRole', 'authProvider', 'isActive', 'adminStatus', 'createdAt', 'updatedAt',
    ]));
    expect(listItem?.properties).toMatchObject({
      adminStatus: expect.objectContaining({ enum: ['pending', 'active', 'inactive'] }),
      failedLoginAttempts: expect.any(Object),
      lockedUntil: expect.any(Object),
    });
    expect(detail).toEqual(listItem);

    expect(create?.requestBody?.content?.['application/json']?.schema?.properties).toMatchObject({
      email: expect.any(Object),
      role: expect.objectContaining({ enum: ['admin', 'user'] }),
      platformRole: expect.objectContaining({ enum: ['admin', 'user'] }),
      sendEmail: expect.objectContaining({ default: true }),
    });
    expect(create?.responses?.['201']?.content?.['application/json']?.schema?.properties).toMatchObject({
      user: expect.any(Object),
      inviteUrl: expect.any(Object),
      oneTimePassword: expect.any(Object),
      emailSent: { type: 'boolean' },
    });
    expect(update?.requestBody?.content?.['application/json']?.schema?.properties).toMatchObject({
      firstName: expect.any(Object),
      lastName: expect.any(Object),
      isActive: { type: 'boolean' },
    });
  });

  it('publishes source-aware directory, detail, lifecycle, and authorization contracts', () => {
    const paths = generateOpenApi().paths;
    const directory = paths?.['/api/users/directory']?.get;
    const identity = paths?.['/api/users/{id}/identity-context']?.get;
    const access = paths?.['/api/users/{id}/effective-access']?.get;
    const sessions = paths?.['/api/users/{id}/sessions']?.get;
    const audit = paths?.['/api/users/{id}/audit']?.get;
    const deactivate = paths?.['/api/users/{id}/deactivate']?.post;
    const reactivate = paths?.['/api/users/{id}/reactivate']?.post;
    const revoke = paths?.['/api/users/{id}/revoke-sessions']?.post;

    const directorySchema = directory?.responses?.['200']?.content?.['application/json']?.schema;
    expect(directorySchema?.required).toEqual(expect.arrayContaining(['items', 'total', 'limit', 'offset']));
    expect(directorySchema?.properties?.items?.items?.required).toEqual(expect.arrayContaining([
      'status', 'authenticationSources', 'provisioningSource', 'platformRole',
      'lastSignInAt', 'lastProvisionedAt', 'provisioningHealth',
    ]));
    expect(directory?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'authenticationSource', in: 'query' }),
      expect.objectContaining({ name: 'provisioningSource', in: 'query' }),
      expect.objectContaining({ name: 'limit', in: 'query' }),
    ]));

    expect(identity?.responses?.['200']?.content?.['application/json']?.schema?.required)
      .toEqual(expect.arrayContaining(['user', 'linkedIdentities', 'fieldOwnership', 'recoveryAdministrator']));
    expect(access?.responses?.['200']?.content?.['application/json']?.schema?.required)
      .toEqual(expect.arrayContaining(['userId', 'platformRole', 'lineage', 'evaluatedAt']));

    const sessionItem = sessions?.responses?.['200']?.content?.['application/json']?.schema?.properties?.sessions?.items;
    expect(sessionItem?.required).toEqual(expect.arrayContaining(['id', 'expiresAt', 'authenticationSource']));
    expect(sessionItem?.properties).not.toHaveProperty('tokenHash');
    expect(sessionItem?.properties).not.toHaveProperty('refreshToken');
    expect(audit?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'limit', in: 'query' }),
    ]));

    for (const operation of [deactivate, reactivate, revoke]) {
      expect(operation?.requestBody?.content?.['application/json']?.schema?.required).toContain('reason');
      expect(operation?.responses?.['200']?.content?.['application/json']?.schema?.required)
        .toEqual(expect.arrayContaining(['userId', 'status', 'authSessionVersion', 'changedAt']));
    }

    expect(directory?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'platform.users.read' });
    expect(deactivate?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'platform.users.deactivate' });
    expect(reactivate?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'platform.users.update' });
    expect(revoke?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'platform.users.update' });
  });
});
