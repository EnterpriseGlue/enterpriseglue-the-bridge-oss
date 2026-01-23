import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import settingsRouter from '../../../../src/modules/platform-admin/routes/settings.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { PlatformSettings } from '../../../../src/shared/db/entities/PlatformSettings.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

describe('platform-admin settings routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.locals.enterprisePluginLoaded = false;
    app.use(express.json());
    app.use(settingsRouter);
    vi.clearAllMocks();

    const platformSettingsRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'default',
        appName: 'Test Platform',
      }),
      save: vi.fn().mockResolvedValue({ id: 'default' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return platformSettingsRepo;
        throw new Error('Unexpected repository');
      },
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
});
