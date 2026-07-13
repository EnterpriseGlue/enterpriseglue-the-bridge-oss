import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  Engine,
  EngineProjectAccess,
  Project,
  ProjectEngineTarget,
} from '@enterpriseglue/shared/db/entities/index.js';
import { projectEngineTargetService } from '@enterpriseglue/shared/services/platform-admin/ProjectEngineTargetService.js';
import { platformSettingsService } from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('projectEngineTargetService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('creates a project-engine target with explicit mode flags', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const targetFindOne = vi.fn().mockResolvedValue(null);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: null }) };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }) };
        if (entity === ProjectEngineTarget) return { findOne: targetFindOne, insert };
        throw new Error('Unexpected repository');
      },
    });

    const result = await projectEngineTargetService.createTarget({
      projectId: 'project-1',
      engineId: 'engine-1',
      allowManualDeploy: true,
      allowCiDeploy: true,
      allowApiDeploy: false,
      allowImport: true,
      createdById: 'admin-1',
    });

    expect(result.id).toEqual(expect.any(String));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      engineId: 'engine-1',
      status: 'active',
      source: 'manual',
      allowManualDeploy: true,
      allowCiDeploy: true,
      allowApiDeploy: false,
      allowImport: true,
      createdById: 'admin-1',
    }));
  });

  it('stores external metadata, approval state, policy tags, and diagnostics for source-owned targets', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const targetFindOne = vi.fn().mockResolvedValue(null);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: null }) };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }) };
        if (entity === ProjectEngineTarget) return { findOne: targetFindOne, insert };
        throw new Error('Unexpected repository');
      },
    });

    await projectEngineTargetService.createTarget({
      projectId: 'project-1',
      engineId: 'engine-1',
      source: 'external',
      sourceRef: 'external_engine_system:system-1:project_engine_target:target-ext-1',
      externalSystemId: 'system-1',
      externalProjectId: 'cmdb-project-1',
      externalEngineId: 'cluster-a/prod',
      externalTargetId: 'target-ext-1',
      approvalStatus: 'approved',
      policyTags: ['prod', 'regulated', 'prod'],
      diagnostics: { owner: 'cmdb', confidence: 'high' },
      allowSourceOwnedMutation: true,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      source: 'external',
      externalSystemId: 'system-1',
      externalProjectId: 'cmdb-project-1',
      externalEngineId: 'cluster-a/prod',
      externalTargetId: 'target-ext-1',
      approvalStatus: 'approved',
      approvedAt: expect.any(Number),
      policyTagsJson: JSON.stringify(['prod', 'regulated']),
      diagnosticsJson: JSON.stringify({ owner: 'cmdb', confidence: 'high' }),
    }));
  });

  it('checks active targets by deployment mode', async () => {
    const targetFindOne = vi.fn().mockResolvedValue({
      id: 'target-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'engine-1',
      status: 'active',
      allowManualDeploy: true,
      allowCiDeploy: false,
      allowApiDeploy: false,
      allowImport: true,
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return { findOne: targetFindOne };
        throw new Error('Unexpected repository');
      },
    });

    await expect(projectEngineTargetService.hasActiveTarget('project-1', 'engine-1', 'manual')).resolves.toBe(true);
    await expect(projectEngineTargetService.hasActiveTarget('project-1', 'engine-1', 'ci')).resolves.toBe(false);
  });

  it('mirrors legacy engine access into a legacy source target on first target check', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const targetFindOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const accessFindOne = vi.fn().mockResolvedValue({
      projectId: 'project-1',
      engineId: 'engine-1',
      grantedById: 'owner-1',
      autoApproved: true,
    });

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return { findOne: targetFindOne, insert };
        if (entity === EngineProjectAccess) return { findOne: accessFindOne };
        if (entity === Project) return { findOne: vi.fn().mockResolvedValue({ id: 'project-1', tenantId: null }) };
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(projectEngineTargetService.hasActiveTarget('project-1', 'engine-1', 'manual')).resolves.toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      engineId: 'engine-1',
      source: 'legacy',
      sourceRef: 'engine_project_access:project-1:engine-1',
      allowManualDeploy: true,
      allowImport: true,
      approvedById: 'owner-1',
    }));
  });

  it('skips legacy mirroring when the pair is already source-owned', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'target-1',
            tenantId: null,
            projectId: 'project-1',
            engineId: 'engine-1',
            source: 'external',
            sourceRef: 'cmdb:project-1:engine-1',
          }),
          insert,
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(projectEngineTargetService.ensureTargetFromLegacyAccess(
      'project-1',
      'engine-1',
      'owner-1',
      true
    )).resolves.toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('archives only legacy-owned targets on legacy revoke', async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'target-1',
            tenantId: null,
            projectId: 'project-1',
            engineId: 'engine-1',
            source: 'legacy',
            sourceRef: 'engine_project_access:project-1:engine-1',
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    });

    await projectEngineTargetService.archiveLegacyTarget('project-1', 'engine-1');
    expect(update).toHaveBeenCalledWith({ id: 'target-1' }, expect.objectContaining({ status: 'archived' }));
  });

  it('rejects manual creation of source-owned project-engine targets', async () => {
    await expect(projectEngineTargetService.createTarget({
      projectId: 'project-1',
      engineId: 'engine-1',
      source: 'external',
    })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Source-owned project-engine targets must be created or changed through their owning integration',
    });
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('rejects manual updates to source-owned project-engine targets', async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'target-1',
            tenantId: null,
            projectId: 'project-1',
            engineId: 'engine-1',
            source: 'external',
            sourceRef: 'cmdb:project-1:engine-1',
            status: 'active',
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(projectEngineTargetService.updateTarget('target-1', {
      allowManualDeploy: false,
    })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Project-engine target is managed by external (cmdb:project-1:engine-1) and cannot be changed through manual target management',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('allows config-warning target edits and marks drift', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'target-warning', tenantId: null, projectId: 'project-1', engineId: 'engine-1',
            source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn',
            status: 'active', allowManualDeploy: true, allowCiDeploy: false, allowApiDeploy: false, allowImport: true,
            approvedById: null, approvalStatus: 'not_required', approvedAt: null, policyTagsJson: null, diagnosticsJson: null,
            externalSystemId: null, externalProjectId: null, externalEngineId: null, externalTargetId: null,
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    });

    await projectEngineTargetService.updateTarget('target-warning', { allowCiDeploy: true });

    expect(update).toHaveBeenCalledWith({ id: 'target-warning' }, expect.objectContaining({
      allowCiDeploy: true, driftStatus: 'drifted',
    }));
  });

  it('allows source-owned target updates through an owning integration path', async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return {
          findOneBy: vi.fn().mockResolvedValue({
            id: 'target-1',
            tenantId: null,
            projectId: 'project-1',
            engineId: 'engine-1',
            source: 'external',
            sourceRef: 'cmdb:project-1:engine-1',
            status: 'active',
            allowManualDeploy: true,
            allowCiDeploy: false,
            allowApiDeploy: false,
            allowImport: true,
            approvedById: null,
          }),
          update,
        };
        throw new Error('Unexpected repository');
      },
    });

    await projectEngineTargetService.updateTarget('target-1', {
      allowSourceOwnedMutation: true,
      allowCiDeploy: true,
    });

    expect(update).toHaveBeenCalledWith({ id: 'target-1' }, expect.objectContaining({
      source: 'external',
      sourceRef: 'cmdb:project-1:engine-1',
      allowCiDeploy: true,
    }));
  });

  it('rejects manual target management in external-only policy mode', async () => {
    vi.spyOn(platformSettingsService, 'get').mockResolvedValue({
      projectEngineTargetMode: 'external_only',
    } as any);

    await expect(projectEngineTargetService.createTarget({
      projectId: 'project-1',
      engineId: 'engine-1',
    })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Project-engine target management is external-only by platform policy; use the owning external system to create or change deployment targets',
    });
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('skips legacy target sync in external-only policy mode', async () => {
    vi.spyOn(platformSettingsService, 'get').mockResolvedValue({
      projectEngineTargetMode: 'external_only',
    } as any);

    await expect(projectEngineTargetService.syncLegacyAccessForProject('project-1')).resolves.toEqual({
      createdOrUpdated: 0,
    });
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('does not count local targets as active in external-only policy mode', async () => {
    vi.spyOn(platformSettingsService, 'get').mockResolvedValue({
      projectEngineTargetMode: 'external_only',
    } as any);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'target-1',
            tenantId: null,
            projectId: 'project-1',
            engineId: 'engine-1',
            source: 'manual',
            status: 'active',
            allowManualDeploy: true,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(projectEngineTargetService.hasActiveTarget('project-1', 'engine-1', 'manual')).resolves.toBe(false);
  });

  it('counts source-owned targets as active in external-only policy mode', async () => {
    vi.spyOn(platformSettingsService, 'get').mockResolvedValue({
      projectEngineTargetMode: 'external_only',
    } as any);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectEngineTarget) return {
          findOne: vi.fn().mockResolvedValue({
            id: 'target-1',
            tenantId: null,
            projectId: 'project-1',
            engineId: 'engine-1',
            source: 'external',
            status: 'active',
            allowManualDeploy: true,
          }),
        };
        throw new Error('Unexpected repository');
      },
    });

    await expect(projectEngineTargetService.hasActiveTarget('project-1', 'engine-1', 'manual')).resolves.toBe(true);
  });
});
