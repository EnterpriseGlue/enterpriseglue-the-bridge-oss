import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import emailConfigsRouter from '../../../../../packages/backend-host/src/modules/admin/routes/email-configs.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EmailSendConfig } from '@enterpriseglue/shared/db/entities/EmailSendConfig.js';
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

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EmailSendConfig) return configRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/admin/email-configs');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe('Primary SMTP');
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
});
