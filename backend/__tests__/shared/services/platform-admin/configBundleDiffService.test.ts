import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const bundle = {
  apiVersion: 'enterpriseglue.ai/v1alpha1',
  kind: 'EnterpriseGlueConfigBundle',
  metadata: { key: 'acme.authz', owner: 'platform' },
  tenantKey: 'acme',
  mode: 'authoritative',
  settings: {},
  imports: ['./roles.json', './groups.json'],
};

function mockDataSource(roles: unknown[] = [], groups: unknown[] = [], permissions: unknown[] = [], engines: unknown[] = [], identityProviders: unknown[] = []) {
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository: (entity: unknown) => {
      if (entity === RbacRole) return { find: vi.fn().mockResolvedValue(roles) };
      if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue(groups) };
      if (entity === Engine) return { find: vi.fn().mockResolvedValue(engines) };
      if (entity === EngineSet) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === RuntimeResourceSet) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue(permissions) };
      if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue(identityProviders) };
      throw new Error('Unexpected repository');
    },
  });

}

describe('configBundleDiffService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('identifies creation and authoritative archival without mutating persisted state', async () => {
    mockDataSource([], [{
      id: 'group-stale', tenantId: 'tenant-a', key: 'group.stale', name: 'Stale', description: null,
      source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    }]);

    const result = await configBundleDiffService.diff({
      bundle,
      files: {
        './roles.json': {
          roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }],
        },
        './groups.json': {
          groups: [{ key: 'group.deployers', name: 'Deployers' }],
        },
      },
    }, 'tenant-a');

    expect(result).toMatchObject({ valid: true, canonicalHash: expect.any(String) });
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'role', key: 'custom.engine.deployer', operation: 'create' }),
      expect.objectContaining({ objectType: 'group', key: 'group.deployers', operation: 'create' }),
      expect.objectContaining({ objectType: 'group', key: 'group.stale', operation: 'archive' }),
    ]));
  });

  it('does not allow a bundle to silently take over a manual role or group', async () => {
    mockDataSource([
      { id: 'role-1', tenantId: 'tenant-a', key: 'custom.engine.deployer', source: 'manual', sourceRef: null },
    ], [
      { id: 'group-1', tenantId: 'tenant-a', key: 'group.deployers', source: 'manual', sourceRef: null },
    ]);

    const result = await configBundleDiffService.diff({
      bundle,
      files: {
        './roles.json': {
          roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }],
        },
        './groups.json': {
          groups: [{ key: 'group.deployers', name: 'Deployers' }],
        },
      },
    }, 'tenant-a');

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'role', key: 'custom.engine.deployer', operation: 'conflict', currentId: 'role-1' }),
      expect.objectContaining({ objectType: 'group', key: 'group.deployers', operation: 'conflict', currentId: 'group-1' }),
    ]));
  });

  it('includes config-owned Runtime Resource Sets in the persisted-state diff', async () => {
    mockDataSource([], [], [], [{ id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central' }]);
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './runtime-resource-sets.json'] },
      files: {
        './engines.json': {
          engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }],
        },
        './runtime-resource-sets.json': {
          runtimeResourceSets: [{
            key: 'runtime.payments', name: 'Payments processes', engineRef: { engineKey: 'engine.central' },
            resourceKind: 'process_definition', selector: { mode: 'prefix', prefix: 'payments-' },
          }],
        },
      },
    }, 'tenant-a');
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'runtime_resource_set', key: 'runtime.payments', operation: 'create' }),
    ]));
  });

  it('includes config-owned identity providers in the persisted-state diff', async () => {
    mockDataSource([], [], [], [], []);
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./identity-providers.json'] },
      files: { './identity-providers.json': { identityProviders: [{
        key: 'identity.oidc.main', type: 'oidc', enabled: true, authenticationMode: 'claims_only',
        sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' },
        oidc: { issuerUrl: 'https://login.example.test', clientId: 'enterpriseglue', callbackUrl: 'https://app.example.test/callback', scopes: ['openid'] },
      }] } },
    }, 'tenant-a');
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'identity_provider', key: 'identity.oidc.main', operation: 'create' }),
    ]));
  });
});
