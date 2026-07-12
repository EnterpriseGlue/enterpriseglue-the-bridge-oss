import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import setupStatusRouter from '../../../../../packages/backend-host/src/modules/admin/routes/setup-status.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { EmailSendConfig } from '@enterpriseglue/shared/db/entities/EmailSendConfig.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

const authState = vi.hoisted(() => ({
  user: { userId: 'user-1', platformRole: 'admin' } as any,
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = authState.user;
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    SETTINGS_MANAGE: 'platform:settings:manage',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  projectMemberService: {
    getMembership: vi.fn(),
  },
  engineService: {
    getEngineRole: vi.fn(),
  },
}));

describe('GET /api/admin/setup-status', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(setupStatusRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    authState.user = { userId: 'user-1', platformRole: 'admin' };
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (_permission: string, context: { platformRole?: string }) =>
      context.platformRole === 'admin'
    );
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
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:settings:manage', expect.objectContaining({
      userId: 'user-1',
      platformRole: 'admin',
      resourceType: 'platform',
    }));
    expect(response.body.isConfigured).toBe(true);
    expect(response.body.checks.hasDefaultTenant).toBe(true);
    expect(response.body.checks.hasAdminUser).toBe(true);
    expect(response.body.requiredActions).toHaveLength(0);
  });

  it('denies setup status without settings permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get('/api/admin/setup-status');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('platform.settings.read');
    expect(getDataSource).not.toHaveBeenCalled();
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
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(setupStatusRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
  });

  it('allows admin to mark setup complete', async () => {
    const response = await request(app).post('/api/admin/mark-setup-complete');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('allows settings managers to mark setup complete without platform admin role', async () => {
    authState.user = { userId: 'settings-1', platformRole: 'user' };
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'platform:settings:manage'
    );

    const response = await request(app).post('/api/admin/mark-setup-complete');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:settings:manage', expect.objectContaining({
      userId: 'settings-1',
      platformRole: 'user',
    }));
  });
});
