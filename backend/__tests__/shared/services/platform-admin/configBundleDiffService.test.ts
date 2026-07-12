import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
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

function mockDataSource(roles: unknown[] = [], groups: unknown[] = [], permissions: unknown[] = [], engines: unknown[] = []) {
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository: (entity: unknown) => {
      if (entity === RbacRole) return { find: vi.fn().mockResolvedValue(roles) };
      if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue(groups) };
      if (entity === Engine) return { find: vi.fn().mockResolvedValue(engines) };
      if (entity === EngineSet) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue(permissions) };
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
});
