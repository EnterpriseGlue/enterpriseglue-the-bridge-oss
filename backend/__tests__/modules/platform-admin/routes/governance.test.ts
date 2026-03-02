import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import governanceRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/governance.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  policyService: {
    listPolicies: vi.fn().mockResolvedValue([]),
  },
  ssoClaimsMappingService: {
    listMappings: vi.fn().mockResolvedValue([]),
  },
}));

describe('platform-admin governance routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(governanceRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
      }),
    });
  });

  it('placeholder test for governance routes', () => {
    expect(true).toBe(true);
  });
});
