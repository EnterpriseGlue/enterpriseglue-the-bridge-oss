import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import settingsRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/settings.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';
import { PlatformSettingsSectionOwnership } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettingsSectionOwnership.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (req: any, _res: unknown, next: () => void) => {
    req.user = { userId: 'admin-1' };
    next();
  },
}));

describe('platform-admin settings routes', () => {
  let app: express.Application;
  let platformSettingsRepo: {
    findOne: Mock;
    findOneBy: Mock;
    save: Mock;
    insert: Mock;
    update: Mock;
  };
  let settingsOwnershipRepo: { find: Mock; update: Mock };

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.locals.enterprisePluginLoaded = false;
    app.use(express.json());
    app.use(settingsRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    platformSettingsRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'default',
        appName: 'Test Platform',
      }),
      findOneBy: vi.fn().mockResolvedValue({ id: 'default' }),
      save: vi.fn().mockResolvedValue({ id: 'default' }),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };

    settingsOwnershipRepo = {
      find: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return platformSettingsRepo;
        if (entity === PlatformSettingsSectionOwnership) return settingsOwnershipRepo;
        throw new Error('Unexpected repository');
      },
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      ...manager,
      transaction: (work: (store: typeof manager) => unknown) => work(manager),
    });
  });

  it('placeholder test for settings routes', () => {
    expect(true).toBe(true);
  });

  it('returns not found when enterprise plugin is loaded', async () => {
    app.locals.enterprisePluginLoaded = true;

    const response = await request(app).get('/');

    expect(response.status).toBe(404);
  });

  it('returns the documented validation error for unsupported runtime authorization modes', async () => {
    const response = await request(app).put('/').send({
      engineRuntimeAuthorizationMode: 'engine_native_authority',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Validation failed',
      issues: [{
        path: 'engineRuntimeAuthorizationMode',
        message: 'Unsupported runtime authorization mode',
        code: 'invalid_value',
      }],
    });
  });

  it('rejects portal changes to config-locked governance settings', async () => {
    platformSettingsRepo.findOneBy.mockResolvedValue({
      id: 'default',
      accessGovernanceSourceRef: 'config_bundle:acme.authz',
      accessGovernanceOwnershipMode: 'config_locked',
    });
    settingsOwnershipRepo.find.mockResolvedValue([{
      id: 'default:governance', settingsId: 'default', section: 'governance',
      scopeKey: 'platform', sourceRef: 'config_bundle:acme.authz',
      ownershipMode: 'config_locked', generation: 1,
    }]);

    const response = await request(app).put('/').send({
      engineAccessAuthority: 'sso_managed',
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('managed by configuration');
    expect(platformSettingsRepo.update).not.toHaveBeenCalled();
  });

  it('allows config-warning governance edits and marks the settings drifted', async () => {
    platformSettingsRepo.findOneBy.mockResolvedValue({
      id: 'default',
      accessGovernanceSourceRef: 'config_bundle:acme.authz',
      accessGovernanceOwnershipMode: 'config_warn',
    });
    settingsOwnershipRepo.find.mockResolvedValue([{
      id: 'default:governance', settingsId: 'default', section: 'governance',
      scopeKey: 'platform', sourceRef: 'config_bundle:acme.authz',
      ownershipMode: 'config_warn', driftStatus: 'in_sync', generation: 1,
    }]);

    const response = await request(app).put('/').send({
      engineAccessAuthority: 'transition_to_sso',
    });

    expect(response.status).toBe(200);
    expect(platformSettingsRepo.update).toHaveBeenCalledWith(
      { id: 'default' },
      expect.objectContaining({
        engineAccessAuthority: 'transition_to_sso',
        accessGovernanceDriftStatus: 'drifted',
      }),
    );
    expect(settingsOwnershipRepo.update).toHaveBeenCalledWith(
      { id: 'default:governance', generation: 1 },
      expect.objectContaining({ generation: 2, driftStatus: 'drifted' }),
    );
  });
});
