import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import signupRouter from '../../../../src/modules/auth/routes/signup.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { User } from '../../../../src/shared/db/entities/User.js';
import { Tenant } from '../../../../src/shared/db/entities/Tenant.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/email/index.js', () => ({
  sendVerificationEmail: vi.fn(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {},
}));

describe('GET /api/auth/signup/check-slug', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(signupRouter);
    vi.clearAllMocks();
  });

  it('returns available for unused slug', async () => {
    const tenantRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Tenant) return tenantRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/signup/check-slug?slug=test-org');

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(true);
  });

  it('returns unavailable for existing slug', async () => {
    const tenantRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'tenant-1' }) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Tenant) return tenantRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/signup/check-slug?slug=existing-org');

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(false);
  });
});
