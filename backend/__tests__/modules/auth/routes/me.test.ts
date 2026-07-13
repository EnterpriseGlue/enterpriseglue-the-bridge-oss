import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import meRouter from '../../../../../packages/backend-host/src/modules/auth/routes/me.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', type: 'access', platformRole: 'user' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: { USER_UPDATE: 'USER_UPDATE' },
}));

vi.mock('@enterpriseglue/shared/services/capabilities.js', () => ({
  buildUserCapabilities: vi.fn().mockResolvedValue({
    canViewAdminMenu: false,
    canAccessAdminRoutes: false,
    canManageUsers: false,
    canViewAuditLogs: false,
    canManagePlatformSettings: false,
    canViewMissionControl: false,
    canManageTenants: false,
  }),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', () => ({
  getActivePlatformAdministratorUserIds: vi.fn().mockResolvedValue(new Set()),
}));

describe('GET /api/auth/me', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(meRouter);
    vi.clearAllMocks();
  });

  it('returns current user profile', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      platformRole: 'user',
      isActive: true,
      createdAt: 1000,
    };

    const userRepo = { findOneBy: vi.fn().mockResolvedValue(mockUser) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.email).toBe('test@example.com');
    expect(response.body.session).toEqual({
      principal: { type: 'user', id: 'user-1' },
      tenant: { id: null },
    });
  });

  it('returns branding settings', async () => {
    const mockSettings = {
      id: 'default',
      logoUrl: 'https://example.com/logo.png',
      logoTitle: 'My Platform',
    };

    const settingsRepo = { findOneBy: vi.fn().mockResolvedValue(mockSettings) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return settingsRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/branding');

    expect(response.status).toBe(200);
    expect(response.body.logoUrl).toBe('https://example.com/logo.png');
  });

  it('returns authenticated platform settings with engine onboarding mode', async () => {
    const mockSettings = {
      id: 'default',
      syncPushEnabled: true,
      syncPullEnabled: false,
      gitProjectTokenSharingEnabled: false,
      defaultDeployRoles: JSON.stringify(['owner', 'delegate', 'operator']),
      engineOnboardingMode: 'external_only',
      projectEngineTargetMode: 'hybrid',
      engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
      ssoAllEnginesAssignmentMappingsEnabled: false,
      ssoEngineOwnerAssignmentMappingsEnabled: true,
      ssoEngineDelegateAssignmentMappingsEnabled: false,
      ssoRegexClaimMappingsEnabled: true,
      ssoSecretViewMappingsEnabled: true,
      ssoUnredactedAuditMappingsEnabled: false,
      ssoPermanentDeleteMappingsEnabled: false,
    };

    const settingsRepo = { findOneBy: vi.fn().mockResolvedValue(mockSettings) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === PlatformSettings) return settingsRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/auth/platform-settings');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      syncPushEnabled: true,
      defaultDeployRoles: ['owner', 'delegate', 'operator'],
      engineOnboardingMode: 'external_only',
      projectEngineTargetMode: 'hybrid',
      engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
      ssoAllEnginesAssignmentMappingsEnabled: false,
      ssoEngineOwnerAssignmentMappingsEnabled: true,
      ssoEngineDelegateAssignmentMappingsEnabled: false,
      ssoRegexClaimMappingsEnabled: true,
      ssoSecretViewMappingsEnabled: true,
      ssoUnredactedAuditMappingsEnabled: false,
      ssoPermanentDeleteMappingsEnabled: false,
    });
  });
});
