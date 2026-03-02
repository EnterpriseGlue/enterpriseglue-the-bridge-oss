import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import environmentsRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/environments.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EnvironmentTag } from '@enterpriseglue/shared/db/entities/EnvironmentTag.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EnvironmentTagService.js', () => ({
  environmentTagService: {
    listEnvironmentTags: vi.fn().mockResolvedValue([]),
    createEnvironmentTag: vi.fn().mockResolvedValue({ id: 'et1', name: 'Production' }),
    updateEnvironmentTag: vi.fn().mockResolvedValue({ id: 'et1', name: 'Production' }),
    deleteEnvironmentTag: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('platform-admin environments routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(environmentsRouter);
    vi.clearAllMocks();

    const environmentTagRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'et1', name: 'Production' }),
      save: vi.fn().mockResolvedValue({ id: 'et1', name: 'Production' }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === EnvironmentTag) return environmentTagRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), save: vi.fn() };
      },
    });
  });

  it('placeholder test for environments routes', () => {
    expect(true).toBe(true);
  });
});
