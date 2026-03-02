import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import ssoProvidersRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/sso-providers.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

describe('platform-admin sso-providers routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(ssoProvidersRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
      }),
    });
  });

  it('placeholder test for sso-providers routes', () => {
    expect(true).toBe(true);
  });
});
