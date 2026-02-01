import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import emailConfigsRouter from '../../../../src/modules/admin/routes/email-configs.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { EmailSendConfig } from '../../../../src/shared/db/entities/EmailSendConfig.js';

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

vi.mock('@shared/utils/crypto.js', () => ({
  encrypt: vi.fn((val) => `encrypted:${val}`),
  decrypt: vi.fn((val) => val.replace('encrypted:', '')),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {},
}));

describe('GET /api/admin/email-configs', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(emailConfigsRouter);
    vi.clearAllMocks();
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
  });
});
