import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import brandingRouter from '../../../../src/modules/platform-admin/routes/branding.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { PlatformSettings } from '../../../../src/shared/db/entities/PlatformSettings.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

describe('platform-admin branding routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.locals.enterprisePluginLoaded = false;
    app.use(express.json());
    app.use(brandingRouter);
    vi.clearAllMocks();

    const platformSettingsRepo = {
      findOne: vi.fn().mockResolvedValue({
        logoUrl: 'https://example.com/logo.png',
        logoTitle: 'Test Platform',
        logoScale: 100,
      }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return platformSettingsRepo;
        throw new Error('Unexpected repository');
      },
    });
  });

  it('gets platform branding', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.logoUrl).toBeDefined();
  });

  it('returns not found when enterprise plugin is loaded', async () => {
    app.locals.enterprisePluginLoaded = true;

    const response = await request(app).get('/');

    expect(response.status).toBe(404);
  });
});
