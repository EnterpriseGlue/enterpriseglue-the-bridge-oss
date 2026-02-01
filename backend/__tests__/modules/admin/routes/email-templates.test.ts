import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import emailTemplatesRouter from '../../../../src/modules/admin/routes/email-templates.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { PlatformSettings } from '../../../../src/shared/db/entities/PlatformSettings.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: { USER_UPDATE: 'user.update' },
}));

describe('GET /api/admin/email-platform-name', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(emailTemplatesRouter);
    vi.clearAllMocks();
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
