import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import emailTemplatesRouter from '../../../../../packages/backend-host/src/modules/admin/routes/email-templates.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';
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

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: { USER_UPDATE: 'user.update' },
}));

describe('GET /api/admin/email-platform-name', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(emailTemplatesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
  });

  it('returns email platform name', async () => {
    const settingsRepo = {
      findOne: vi.fn().mockResolvedValue({ emailPlatformName: 'Test Platform' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return settingsRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/admin/email-platform-name');

    expect(response.status).toBe(200);
    expect(response.body.emailPlatformName).toBe('Test Platform');
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      PlatformPermissions.SETTINGS_MANAGE,
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'platform',
        tenantId: null,
      })
    );
  });

  it('denies email platform name without settings permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get('/api/admin/email-platform-name');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('platform.settings.read');
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('returns default name when settings not found', async () => {
    const settingsRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return settingsRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/admin/email-platform-name');

    expect(response.status).toBe(200);
    expect(response.body.emailPlatformName).toBe('EnterpriseGlue');
  });
});
