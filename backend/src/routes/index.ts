import { Express, Router } from 'express';
import { resolveTenantContext } from '@shared/middleware/tenant.js';

// Feature Modules
import {
  projectsRoute,
  filesRoute,
  foldersRoute,
  versionsRoute,
  commentsRoute,
  deploymentsRoute,
  membersRoute,
  engineDeploymentsRoute,
} from '@modules/starbase/index.js';

import {
  missionControlRoute,
  enginesAndFiltersRoute,
  batchesRoute,
  migrationRoute,
  directRoute,
  processDefinitionsRoute,
  processInstancesRoute,
  tasksRoute,
  externalTasksRoute,
  messagesRoute,
  decisionsRoute,
  jobsRoute,
  historyExtendedRoute,
  metricsRoute,
  modifyRoute,
} from '@modules/mission-control/index.js';

import {
  enginesDeploymentsRoute,
  engineManagementRoute,
} from '@modules/engines/index.js';

import {
  gitRoute,
  gitCredentialsRoute,
  gitCreateOnlineRoute,
  gitSyncRoute,
  gitCloneRoute,
} from '@modules/git/index.js';

import {
  platformAdminRoute,
  authzRoute,
  ssoProvidersRoute,
} from '@modules/platform-admin/index.js';

import {
  loginRoute,
  logoutRoute,
  refreshRoute,
  passwordRoute,
  meRoute,
  verifyEmailRoute,
  microsoftRoute,
  forgotPasswordRoute,
  googleRoute,
  googleStartRoute,
  microsoftStartRoute,
} from '@modules/auth/index.js';

import {
  contactAdminRoute,
  emailConfigsRoute,
  emailTemplatesRoute,
  setupStatusRoute,
} from '@modules/admin/index.js';

import {
  dashboardStatsRoute,
  dashboardContextRoute,
} from '@modules/dashboard/index.js';

import { usersRoute } from '@modules/users/index.js';
import { auditRoute } from '@modules/audit/index.js';
import { notificationsRoute } from '@modules/notifications/index.js';
import vcsRoute from '@modules/versioning/index.js';

/**
 * Create a router for tenant-scoped routes
 * All routes mounted here will be accessible under /t/:tenantSlug/*
 */
function createTenantScopedRouter(options: { includeAuditRoute?: boolean } = {}): Router {
  const router = Router({ mergeParams: true });
  const { includeAuditRoute = true } = options;

  // Apply tenant context middleware to all tenant-scoped routes
  router.use(resolveTenantContext({ required: true }));

  // Starbase routes (projects, files, folders, etc.)
  router.use(projectsRoute);
  router.use(filesRoute);
  router.use(foldersRoute);
  router.use(versionsRoute);
  router.use(commentsRoute);
  router.use(deploymentsRoute);
  router.use(membersRoute);
  router.use(engineDeploymentsRoute);

  // Mission Control routes (engines, batches, processes, etc.)
  router.use(missionControlRoute);
  router.use(enginesAndFiltersRoute);
  router.use(batchesRoute);
  router.use(migrationRoute);
  router.use(directRoute);
  router.use(processDefinitionsRoute);
  router.use(processInstancesRoute);
  router.use(tasksRoute);
  router.use(externalTasksRoute);
  router.use(messagesRoute);
  router.use(decisionsRoute);
  router.use(jobsRoute);
  router.use(historyExtendedRoute);
  router.use(metricsRoute);
  router.use(modifyRoute);

  // Engines API
  router.use(enginesDeploymentsRoute);
  router.use(engineManagementRoute);

  // Git versioning routes
  router.use(gitRoute);
  router.use(gitCredentialsRoute);
  router.use(gitCreateOnlineRoute);
  router.use(gitSyncRoute);
  router.use(gitCloneRoute);

  // VCS routes
  router.use(vcsRoute);

  // Tenant-scoped API routes
  router.use(usersRoute);
  if (includeAuditRoute) {
    router.use(auditRoute);
  }
  router.use(notificationsRoute);
  router.use(dashboardStatsRoute);
  router.use(dashboardContextRoute);

  return router;
}

/**
 * Register all application routes
 * 
 * Routes are organized into:
 * 1. Platform-level routes (auth, admin) - no tenant prefix
 * 2. Tenant-scoped routes - mounted under /t/:tenantSlug
 */
export function registerRoutes(app: Express): void {
  const enterprisePluginLoaded = Boolean(app.locals?.enterprisePluginLoaded);
  // ============ Platform-Level Routes (no tenant prefix) ============
  
  // Authentication routes
  app.use(loginRoute);
  app.use(logoutRoute);
  app.use(refreshRoute);
  app.use(passwordRoute);
  app.use(forgotPasswordRoute);
  app.use(meRoute);
  app.use(verifyEmailRoute);
  app.use(microsoftRoute);
  app.use(googleRoute);
  app.use(microsoftStartRoute);
  app.use(googleStartRoute);

  // Admin routes (platform-level)
  app.use(emailConfigsRoute);
  if (!enterprisePluginLoaded) {
    app.use(emailTemplatesRoute);
  }
  app.use(setupStatusRoute);

  // Contact admin route (public, no auth required)
  app.use('/api/contact-admin', contactAdminRoute);

  // Platform Admin API
  app.use('/api/admin', platformAdminRoute);

  // SSO Provider Management API (platform-level)
  app.use(ssoProvidersRoute);

  // Authorization API (platform-level)
  app.use(authzRoute);

  // Platform-level user management (for admin access without tenant prefix)
  app.use(usersRoute);

  // ============ Tenant-Scoped Routes ============
  // All routes below are accessible under /t/:tenantSlug/*
  // Example: /t/default/starbase-api/projects
  
  app.use('/t/:tenantSlug', createTenantScopedRouter({ includeAuditRoute: !enterprisePluginLoaded }));
}
