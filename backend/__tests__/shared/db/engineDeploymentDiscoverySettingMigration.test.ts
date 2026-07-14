import { describe, expect, it, vi } from 'vitest';
import { AddEngineDeploymentDiscoverySetting1700000000075 } from '@enterpriseglue/shared/db/migrations/1700000000075-add-engine-deployment-discovery-setting.js';

describe('AddEngineDeploymentDiscoverySetting1700000000075', () => {
  it('adds the deployment discovery switch once', async () => {
    const addColumn = vi.fn();
    const queryRunner = { hasTable: vi.fn().mockResolvedValue(true), hasColumn: vi.fn().mockResolvedValue(false), addColumn };

    await new AddEngineDeploymentDiscoverySetting1700000000075().up(queryRunner as any);

    expect(addColumn).toHaveBeenCalledWith('engines', expect.objectContaining({ name: 'deployment_discovery_enabled', default: true }));
  });

  it('does nothing when the switch already exists', async () => {
    const addColumn = vi.fn();
    const queryRunner = { hasTable: vi.fn().mockResolvedValue(true), hasColumn: vi.fn().mockResolvedValue(true), addColumn };

    await new AddEngineDeploymentDiscoverySetting1700000000075().up(queryRunner as any);

    expect(addColumn).not.toHaveBeenCalled();
  });
});
