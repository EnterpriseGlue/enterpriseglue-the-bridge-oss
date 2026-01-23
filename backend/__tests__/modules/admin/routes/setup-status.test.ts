import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import setupStatusRouter from '../../../../src/modules/admin/routes/setup-status.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';
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

describe('GET /api/admin/setup-status', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(setupStatusRouter);
    vi.clearAllMocks();
  });

  it('returns configured status when all checks pass', async () => {
    const userRepo = { count: vi.fn().mockResolvedValue(1) };
    const emailConfigRepo = { count: vi.fn().mockResolvedValue(1) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === EmailSendConfig) return emailConfigRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/admin/setup-status');

    expect(response.status).toBe(200);
    expect(response.body.isConfigured).toBe(true);
    expect(response.body.checks.hasDefaultTenant).toBe(true);
    expect(response.body.checks.hasAdminUser).toBe(true);
    expect(response.body.requiredActions).toHaveLength(0);
  });

  it('returns not configured when missing admin user', async () => {
    const userRepo = { count: vi.fn().mockResolvedValue(0) };
    const emailConfigRepo = { count: vi.fn().mockResolvedValue(0) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === EmailSendConfig) return emailConfigRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/admin/setup-status');

    expect(response.status).toBe(200);
    expect(response.body.isConfigured).toBe(false);
    expect(response.body.requiredActions).toContain('Configure admin user');
  });
});

describe('POST /api/admin/mark-setup-complete', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(setupStatusRouter);
    vi.clearAllMocks();
  });

  it('allows admin to mark setup complete', async () => {
    const response = await request(app).post('/api/admin/mark-setup-complete');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
