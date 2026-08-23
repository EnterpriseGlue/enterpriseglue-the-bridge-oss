import { afterEach, describe, expect, it, vi } from 'vitest';

const permissionMocks = vi.hoisted(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    ENCRYPTION_KEY: 'a'.repeat(64),
    POSTGRES_HOST: 'localhost',
    POSTGRES_USER: 'test',
    POSTGRES_PASSWORD: 'test',
    POSTGRES_DATABASE: 'test',
    POSTGRES_SCHEMA: 'main',
  });
  return {
    getCurrentUserPermissions: vi.fn(),
  };
});

vi.mock(
  '@enterpriseglue/shared/services/platform-admin/permissions.js',
  () => ({
    EnginePermissions: {
      INSTANCE_VIEW: 'engine:instance:view',
    },
    permissionService: {
      getCurrentUserPermissions: permissionMocks.getCurrentUserPermissions,
    },
  }),
);

import {
  EnginePermissions,
} from '@enterpriseglue/shared/services/platform-admin/permissions.js';

import { loadPluginReadableEngineAccessV1 } from './pluginHostBrokerRoutes.js';

describe('plugin readable-engine access loader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    permissionMocks.getCurrentUserPermissions.mockReset();
  });

  it('returns only engine-level Mission Control read grants for the signed tenant and subject', async () => {
    const permissions = permissionMocks.getCurrentUserPermissions.mockResolvedValue({
        userId: 'subject-1',
        platform: [],
        projects: [],
        engines: [
          {
            resourceId: 'engine-readable',
            permissions: [EnginePermissions.INSTANCE_VIEW],
            runtimePermissions: [],
          },
          {
            resourceId: 'engine-runtime-only',
            permissions: [],
            runtimePermissions: [EnginePermissions.INSTANCE_VIEW],
          },
          {
            resourceId: 'engine-denied',
            permissions: [],
            runtimePermissions: [],
          },
        ],
        authorizationVersion: 'authz-1',
        generatedAt: 1,
      });

    await expect(
      loadPluginReadableEngineAccessV1(
        {
          apiVersion: 'engine-access-request.plugin.enterpriseglue.io/v1',
          callId: 'call-1',
          operationId: 'io.enterpriseglue.example.list-cases',
          limit: 100,
        },
        {
          iss: 'enterpriseglue-oss',
          aud: 'io.enterpriseglue.example',
          sub: 'subject-1',
          iat: 1,
          exp: 2,
          jti: 'invocation-1',
          tenantRef: 'tenant-1',
          deploymentRef: 'deployment-1',
          operationId: 'io.enterpriseglue.example.list-cases',
          grantedPermissions: ['host.engine.access.list_safe'],
          correlationId: 'correlation-1',
        },
      ),
    ).resolves.toEqual({
      apiVersion: 'engine-access.plugin.enterpriseglue.io/v1',
      engineRefs: ['engine-readable'],
    });
    expect(permissions).toHaveBeenCalledWith('subject-1', 'tenant-1');
  });
});
