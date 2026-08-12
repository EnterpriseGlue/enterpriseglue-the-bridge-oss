import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@enterpriseglue/shared/utils/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-machine-secret'),
}));

import { ApiClient } from '@enterpriseglue/shared/infrastructure/persistence/entities/ApiClient.js';
import { AuthzPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzPolicy.js';
import { EmailSendConfig } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailSendConfig.js';
import { EmailTemplate } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailTemplate.js';
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js';
import { GitProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitProvider.js';
import { RbacPermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacPermission.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { ServiceAccount } from '@enterpriseglue/shared/infrastructure/persistence/entities/ServiceAccount.js';
import type { AdminConfigObjectType } from '@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js';
import { adminConfigObjectOwnershipService } from '@enterpriseglue/shared/services/platform-admin/AdminConfigObjectOwnershipService.js';
import { HeadlessAdminCatalogService } from '@enterpriseglue/shared/services/platform-admin/HeadlessAdminCatalogService.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';

const service = new HeadlessAdminCatalogService();
const apiId = '00000000-0000-4000-8000-000000000101';
const serviceId = '00000000-0000-4000-8000-000000000102';

function desiredFixtures(): Record<AdminConfigObjectType, any> {
  return {
    git_provider: {
      key: 'git.primary', name: 'Git', type: 'gitlab', baseUrl: 'https://git.example.com',
      apiUrl: 'https://git.example.com/api/v4', oauth: null, supportsPat: true,
      active: true, displayOrder: 1, ownershipMode: 'config_locked',
    },
    email_configuration: {
      key: 'email.primary', name: 'Mail', provider: 'resend', credentialRef: 'env://MAIL_TOKEN',
      fromName: 'EnterpriseGlue', fromEmail: 'noreply@example.com', replyTo: null, smtp: null,
      enabled: true, isDefault: false, ownershipMode: 'config_locked',
    },
    email_template: {
      key: 'template.welcome', type: 'welcome', name: 'Welcome', subject: 'Welcome',
      htmlTemplate: '<p>Welcome</p>', textTemplate: 'Welcome', variables: [], active: true,
      ownershipMode: 'config_locked',
    },
    permission: {
      key: 'platform:custom:test', scope: 'platform', category: 'Custom', label: 'Test',
      description: 'Test permission', ownershipMode: 'config_locked',
    },
    authorization_policy: {
      key: 'policy.test', name: 'Policy', description: 'Policy', effect: 'allow', priority: 1,
      resourceType: 'platform', action: 'platform:custom:test', conditions: {}, active: true,
      ownershipMode: 'config_locked',
    },
    api_client: {
      kind: 'api_client', key: 'api.test', name: 'API client', tokenRef: 'env://API_TOKEN',
      scopes: ['config:bundle:manage'], active: true, ownershipMode: 'config_locked',
    },
    service_account: {
      kind: 'service_account', key: 'service.test', name: 'Service account', description: 'Deploys',
      tokenRef: 'env://SERVICE_TOKEN', scopes: ['deployment:execute'], active: true,
      ownershipMode: 'config_locked',
    },
    external_engine_system: {
      key: 'external.test', name: 'External system', description: 'Provisioner',
      defaultManagementMode: 'external_managed', defaultFieldOwnership: { name: 'external' },
      active: true, ownershipMode: 'config_locked',
    },
  };
}

function filesFor(objectType: AdminConfigObjectType, desired: any): Record<string, unknown> {
  if (objectType === 'git_provider') return { './git-providers.json': { gitProviders: [desired] } };
  if (objectType === 'email_configuration') return { './email-configurations.json': { emailConfigurations: [desired] } };
  if (objectType === 'email_template') return { './email-templates.json': { emailTemplates: [desired] } };
  if (objectType === 'permission') return { './permissions.json': { permissions: [desired] } };
  if (objectType === 'authorization_policy') return { './authorization-policies.json': { authorizationPolicies: [desired] } };
  if (objectType === 'api_client' || objectType === 'service_account') {
    return { './machine-principals.json': { machinePrincipals: [desired] } };
  }
  return { './external-engine-systems.json': { externalEngineSystems: [desired] } };
}

function repositories() {
  const entityRepos = new Map<unknown, any>();
  for (const entity of [
    GitProvider, EmailSendConfig, EmailTemplate, RbacPermission, AuthzPolicy,
    ApiClient, ServiceAccount, ExternalEngineSystem,
  ]) {
    entityRepos.set(entity, {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      insert: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue([]),
    });
  }
  entityRepos.set(RbacRolePermission, { findOne: vi.fn().mockResolvedValue(null) });
  return {
    entityRepos,
    manager: { getRepository: vi.fn((entity: unknown) => entityRepos.get(entity)) } as any,
  };
}

function change(objectType: AdminConfigObjectType, key: string, operation: 'create' | 'archive' = 'create') {
  return {
    objectType, key, operation, currentId: operation === 'archive' ? `${objectType}-1` : null,
    expectedUpdatedAt: operation === 'archive' ? 10 : undefined,
    expectedOwnershipGeneration: operation === 'archive' ? 2 : undefined,
  } as any;
}

describe('HeadlessAdminCatalogService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(adminConfigObjectOwnershipService, 'claimConfiguration').mockResolvedValue({} as any);
    vi.spyOn(secretResolver, 'resolveStored').mockImplementation((value) => {
      if (value === 'ref:env://API_TOKEN') return `egac_${apiId}_abcdefghijklmnopqrstuvwxyz`;
      if (value === 'ref:env://SERVICE_TOKEN') return `egsa_${serviceId}_abcdefghijklmnopqrstuvwxyz`;
      return null;
    });
  });

  for (const objectType of [
    'git_provider', 'email_configuration', 'email_template', 'permission',
    'authorization_policy', 'api_client', 'service_account', 'external_engine_system',
  ] as AdminConfigObjectType[]) {
    it(`creates and claims ${objectType} in the requested tenant`, async () => {
      const desired = desiredFixtures()[objectType];
      const { entityRepos, manager } = repositories();
      await service.applyChanges(manager, {
        files: filesFor(objectType, desired), changes: [change(objectType, desired.key)],
        sourceRef: 'config_bundle:shared-key', tenantId: 'tenant-a', actorId: 'actor-1', appliedAt: 20,
      });
      expect(adminConfigObjectOwnershipService.claimConfiguration).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          objectType, tenantId: 'tenant-a', configKey: desired.key,
          sourceRef: 'config_bundle:shared-key', appliedAt: 20,
        }),
      );
      const entity = objectType === 'git_provider' ? GitProvider
        : objectType === 'email_configuration' ? EmailSendConfig
          : objectType === 'email_template' ? EmailTemplate
            : objectType === 'permission' ? RbacPermission
              : objectType === 'authorization_policy' ? AuthzPolicy
                : objectType === 'api_client' ? ApiClient
                  : objectType === 'service_account' ? ServiceAccount
                    : ExternalEngineSystem;
      expect(entityRepos.get(entity).insert).toHaveBeenCalledOnce();
    });
  }

  it('rejects a configured machine principal changing its own credential or scopes', async () => {
    const desired = desiredFixtures().api_client;
    const { manager } = repositories();
    await expect(service.applyChanges(manager, {
      files: filesFor('api_client', desired), changes: [change('api_client', desired.key)],
      sourceRef: 'config_bundle:shared-key', tenantId: 'tenant-a', actorId: 'actor-1', appliedAt: 20,
      principalType: 'api_client', principalId: apiId,
    })).rejects.toThrow('cannot modify its own credential or scopes');
  });

  it('rejects unsafe Git endpoints before the catalog object is persisted', async () => {
    const desired = { ...desiredFixtures().git_provider, baseUrl: 'https://169.254.169.254' };
    const { entityRepos, manager } = repositories();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(service.applyChanges(manager, {
        files: filesFor('git_provider', desired), changes: [change('git_provider', desired.key)],
        sourceRef: 'config_bundle:shared-key', tenantId: 'tenant-a', actorId: 'actor-1', appliedAt: 20,
      })).rejects.toThrow('not permitted by endpoint policy');
      expect(entityRepos.get(GitProvider).insert).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  for (const objectType of [
    'git_provider', 'email_configuration', 'email_template', 'permission',
    'authorization_policy', 'api_client', 'service_account', 'external_engine_system',
  ] as AdminConfigObjectType[]) {
    it(`archives ${objectType} and retires its ownership generation`, async () => {
      const { entityRepos, manager } = repositories();
      const current = {
        id: 'ownership-1', objectType, objectId: `${objectType}-1`, configKey: `${objectType}.key`,
        active: true, generation: 2,
      } as any;
      vi.spyOn(adminConfigObjectOwnershipService, 'findForObject').mockResolvedValue(current);
      const deactivate = vi.spyOn(adminConfigObjectOwnershipService, 'deactivateConfiguration').mockResolvedValue();
      await service.applyChanges(manager, {
        files: {}, changes: [change(objectType, current.configKey, 'archive')],
        sourceRef: 'config_bundle:shared-key', tenantId: 'tenant-a', actorId: 'actor-1', appliedAt: 30,
      });
      const entity = objectType === 'git_provider' ? GitProvider
        : objectType === 'email_configuration' ? EmailSendConfig
          : objectType === 'email_template' ? EmailTemplate
            : objectType === 'permission' ? RbacPermission
              : objectType === 'authorization_policy' ? AuthzPolicy
                : objectType === 'api_client' ? ApiClient
                  : objectType === 'service_account' ? ServiceAccount
                    : ExternalEngineSystem;
      expect(entityRepos.get(entity).update).toHaveBeenCalledTimes(2);
      expect(deactivate).toHaveBeenCalledWith(manager, current, 30);
    });
  }

  it('does not archive a custom permission that is still assigned to a role', async () => {
    const { entityRepos, manager } = repositories();
    entityRepos.get(RbacRolePermission).findOne.mockResolvedValueOnce({ id: 'role-permission-1' });
    vi.spyOn(adminConfigObjectOwnershipService, 'findForObject').mockResolvedValue({
      id: 'ownership-1', objectType: 'permission', objectId: 'permission-1', configKey: 'permission.key',
      active: true, generation: 2,
    } as any);
    const deactivate = vi.spyOn(adminConfigObjectOwnershipService, 'deactivateConfiguration').mockResolvedValue();
    await expect(service.applyChanges(manager, {
      files: {}, changes: [change('permission', 'permission.key', 'archive')],
      sourceRef: 'config_bundle:shared-key', tenantId: 'tenant-a', actorId: 'actor-1', appliedAt: 30,
    })).rejects.toThrow('while a role uses it');
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('skips noops and rejects a missing desired object', async () => {
    const { manager } = repositories();
    await expect(service.applyChanges(manager, {
      files: {}, changes: [{ objectType: 'git_provider', key: 'git.primary', operation: 'noop' } as any],
      sourceRef: 'config_bundle:shared-key', actorId: 'actor-1', appliedAt: 20,
    })).resolves.toBeUndefined();
    await expect(service.applyChanges(manager, {
      files: {}, changes: [change('git_provider', 'git.primary')],
      sourceRef: 'config_bundle:shared-key', actorId: 'actor-1', appliedAt: 20,
    })).rejects.toThrow('Missing desired git_provider git.primary');
  });
});
