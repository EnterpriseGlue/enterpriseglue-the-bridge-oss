import { describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { configBundleExportService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleExportService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('configBundleExportService', () => {
  it('exports engine ingestion controls and only secret references', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([{
          id: 'engine-1', configKey: 'engine.prod', name: 'Production', baseUrl: 'https://engine.example.test/engine-rest', type: 'operaton', externalId: null,
          labelsJson: '{"environment":"prod"}', authType: 'basic', username: 'eg', passwordEnc: 'ref:PROD_ENGINE_PASSWORD', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
          version: null, runtimeAccessScope: 'engine_wide', deploymentIntegration: 'direct_engine', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false, connectionMode: 'direct', ownershipMode: 'config_locked',
        }]) };
        if (entity === RbacRole || entity === AuthzGroup || entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue([]) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({ bundleKey: 'acme.authz' });
    expect(result.files['./engines.json']).toEqual({ engines: [expect.objectContaining({
      key: 'engine.prod', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false,
      auth: { type: 'basic', username: 'eg', passwordRef: 'PROD_ENGINE_PASSWORD' },
    })] });
    expect(JSON.stringify(result.files)).not.toContain('ref:PROD_ENGINE_PASSWORD');
  });
});
