import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import brandingRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/branding.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformBrandingService.js', () => ({
  platformBrandingService: {
    get: vi.fn().mockResolvedValue({
      logoUrl: 'https://example.com/logo.png', loginLogoUrl: null,
      loginTitleVerticalOffset: 0, loginTitleColor: null, logoTitle: 'Test Platform', logoScale: 100,
      titleFontUrl: null, titleFontWeight: '600', titleFontSize: 14, titleVerticalOffset: 0,
      menuAccentColor: null, faviconUrl: null, ownership: null,
    }),
    update: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

describe('platform-admin branding routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
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
