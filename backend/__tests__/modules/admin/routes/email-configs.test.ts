import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import emailConfigsRouter from '../../../../../packages/backend-host/src/modules/admin/routes/email-configs.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailSendConfig } from '@enterpriseglue/shared/db/entities/EmailSendConfig.js';
import { AdminConfigObjectOwnership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    SETTINGS_MANAGE: 'platform:settings:manage',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/utils/crypto.js', () => ({
  encrypt: vi.fn((val) => `encrypted:${val}`),
  decrypt: vi.fn((val) => val.replace('encrypted:', '')),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {},
}));

describe('GET /api/admin/email-configs', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(emailConfigsRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
  });

  it('returns list of email configurations', async () => {
    const configRepo = {
      find: vi.fn().mockResolvedValue([
        {
          id: 'config-1',
          name: 'Primary SMTP',
          provider: 'smtp',
          fromName: 'Acme Corp',
          fromEmail: 'noreply@acme.com',
          enabled: true,
        },
      ]),
    };
    const ownershipRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EmailSendConfig) return configRepo;
        if (entity === AdminConfigObjectOwnership) return ownershipRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/admin/email-configs');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe('Primary SMTP');
    expect(response.body[0]).toMatchObject({ ownershipMode: 'manual', sourceRef: null, driftStatus: null });
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      PlatformPermissions.SETTINGS_MANAGE,
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'platform',
        tenantId: null,
      })
    );
  });

  it('denies list without settings permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get('/api/admin/email-configs');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('platform.settings.read');
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('rejects a portal update for a config-locked email configuration before persistence', async () => {
    const update = vi.fn();
    const configRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'config-locked', name: 'Headless mail', provider: 'resend', enabled: true,
      }),
      update,
    };
    const ownershipRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: 'ownership-1', objectType: 'email_configuration', objectId: 'config-locked',
        configKey: 'email-config.headless', ownershipMode: 'config_locked', active: true,
      }),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EmailSendConfig) return configRepo;
      if (entity === AdminConfigObjectOwnership) return ownershipRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: (callback: (manager: unknown) => unknown) => callback({ getRepository }),
    });

    const response = await request(app)
      .patch('/api/admin/email-configs/config-locked')
      .send({ name: 'Portal override' });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('managed by configuration');
    expect(update).not.toHaveBeenCalled();
  });

  it('cannot replace a configuration-owned default email configuration', async () => {
    const update = vi.fn();
    const configRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'manual-target', isDefault: false }),
      find: vi.fn().mockResolvedValue([{ id: 'configured-default' }]),
      update,
    };
    const ownershipRepo = {
      findOneBy: vi.fn().mockImplementation(({ objectId }: { objectId: string }) => Promise.resolve(
        objectId === 'configured-default'
          ? { id: 'ownership-default', objectType: 'email_configuration', objectId, configKey: 'email-config.default', sourceRef: 'config_bundle:headless.admin', ownershipMode: 'config_locked', active: true }
          : null,
      )),
    };
    const getRepository = (entity: unknown) => {
      if (entity === EmailSendConfig) return configRepo;
      if (entity === AdminConfigObjectOwnership) return ownershipRepo;
      throw new Error('Unexpected repository');
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: (callback: (manager: unknown) => unknown) => callback({ getRepository }),
    });

    const response = await request(app).post('/api/admin/email-configs/manual-target/set-default');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('managed by configuration');
    expect(update).not.toHaveBeenCalled();
  });
});
