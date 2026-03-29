import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createNotificationsRouter, noopMiddleware } = vi.hoisted(() => ({
  createNotificationsRouter: vi.fn(),
  noopMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/tenant.js', () => ({
  resolveTenantContext: () => noopMiddleware,
}));

vi.mock('@modules/starbase/index.js', () => ({
  projectsRoute: noopMiddleware,
  filesRoute: noopMiddleware,
  foldersRoute: noopMiddleware,
  versionsRoute: noopMiddleware,
  commentsRoute: noopMiddleware,
  deploymentsRoute: noopMiddleware,
  membersRoute: noopMiddleware,
  engineDeploymentsRoute: noopMiddleware,
}));

vi.mock('@modules/mission-control/index.js', () => ({
  missionControlRoute: noopMiddleware,
  enginesAndFiltersRoute: noopMiddleware,
  batchesRoute: noopMiddleware,
  migrationRoute: noopMiddleware,
  directRoute: noopMiddleware,
  processDefinitionsRoute: noopMiddleware,
  processInstancesRoute: noopMiddleware,
  tasksRoute: noopMiddleware,
  externalTasksRoute: noopMiddleware,
  messagesRoute: noopMiddleware,
  decisionsRoute: noopMiddleware,
  jobsRoute: noopMiddleware,
  historyExtendedRoute: noopMiddleware,
  metricsRoute: noopMiddleware,
  modifyRoute: noopMiddleware,
}));

vi.mock('@modules/engines/index.js', () => ({
  enginesDeploymentsRoute: noopMiddleware,
  engineManagementRoute: noopMiddleware,
}));

vi.mock('@modules/git/index.js', () => ({
  gitRoute: noopMiddleware,
  gitCredentialsRoute: noopMiddleware,
  gitCreateOnlineRoute: noopMiddleware,
  gitSyncRoute: noopMiddleware,
  gitCloneRoute: noopMiddleware,
}));

vi.mock('@modules/platform-admin/index.js', () => ({
  platformAdminRoute: noopMiddleware,
  authzRoute: noopMiddleware,
  ssoProvidersRoute: noopMiddleware,
}));

vi.mock('@modules/auth/index.js', () => ({
  loginRoute: noopMiddleware,
  logoutRoute: noopMiddleware,
  refreshRoute: noopMiddleware,
  passwordRoute: noopMiddleware,
  meRoute: noopMiddleware,
  verifyEmailRoute: noopMiddleware,
  microsoftRoute: noopMiddleware,
  samlRoute: noopMiddleware,
  ssoConfigRoute: noopMiddleware,
  forgotPasswordRoute: noopMiddleware,
  onboardingRoute: noopMiddleware,
  googleRoute: noopMiddleware,
  googleStartRoute: noopMiddleware,
  microsoftStartRoute: noopMiddleware,
  samlStartRoute: noopMiddleware,
}));

vi.mock('@modules/admin/index.js', () => ({
  contactAdminRoute: noopMiddleware,
  emailConfigsRoute: noopMiddleware,
  emailTemplatesRoute: noopMiddleware,
  setupStatusRoute: noopMiddleware,
}));

vi.mock('@modules/dashboard/index.js', () => ({
  dashboardStatsRoute: noopMiddleware,
  dashboardContextRoute: noopMiddleware,
}));

vi.mock('@modules/users/index.js', () => ({
  usersRoute: noopMiddleware,
}));

vi.mock('@modules/audit/index.js', () => ({
  auditRoute: noopMiddleware,
}));

vi.mock('@modules/notifications/index.js', () => ({
  createNotificationsRouter,
}));

vi.mock('@modules/versioning/index.js', () => ({
  default: noopMiddleware,
}));

vi.mock('@modules/invitations/index.js', () => ({
  invitationsRoute: noopMiddleware,
}));

const { registerRoutes } = await import('../../../../packages/backend-host/src/routes/index.js');

describe('backend routes index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationsRouter.mockReturnValue(express.Router());
  });

  it('passes notification tenant resolver into the notifications router factory', () => {
    const app = express();
    const tenantResolver = {
      resolve: vi.fn(() => ({ userId: 'user-1', tenantId: 'tenant-1' })),
    };

    registerRoutes(app, { notificationTenantResolver: tenantResolver });

    expect(createNotificationsRouter).toHaveBeenCalledWith({ tenantResolver });
  });
});
