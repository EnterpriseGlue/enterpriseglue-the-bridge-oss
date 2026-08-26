import { Express, Router } from 'express';
import { resolveTenantContext } from '@enterpriseglue/shared/middleware/tenant.js';
import type { NotificationTenantResolver } from '@enterpriseglue/enterprise-plugin-api/backend';

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
  identityProvidersRoute,
  identityMappingsRoute,
  identityProvisioningRoute,
} from '@modules/platform-admin/index.js';

import {
  loginRoute,
  logoutRoute,
  refreshRoute,
  passwordRoute,
  meRoute,
  verifyEmailRoute,
  ssoConfigRoute,
  forgotPasswordRoute,
  onboardingRoute,
  identityOidcRoute,
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
import { createNotificationsRouter } from '@modules/notifications/index.js';
import vcsRoute from '@modules/versioning/index.js';

import { invitationsRoute } from '@modules/invitations/index.js';
import { scimRoute } from '@modules/scim/index.js';
import { tenancyRoute } from '@modules/tenancy/index.js';
import { config } from '@enterpriseglue/shared/config/index.js';

interface RegisterRoutesOptions {
  notificationTenantResolver?: NotificationTenantResolver;
}

interface CreateTenantScopedRouterOptions {
  includeAuditRoute?: boolean;
  notificationTenantResolver?: NotificationTenantResolver;
}

/**
 * Create a router for tenant-scoped routes
 * All routes mounted here will be accessible under /t/:tenantSlug/*
 */
function createTenantScopedRouter(options: CreateTenantScopedRouterOptions = {}): Router {
  const router = Router({ mergeParams: true });
  const { includeAuditRoute = true, notificationTenantResolver } = options;

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
  // Keep processDefinitionsRoute and decisionsRoute first so specific routes like
  // /mission-control-api/process-definitions/edit-target and
  // /mission-control-api/decision-definitions/edit-target are not shadowed
  // by legacy generic routes mounted in missionControlRoute (which strips engineId
  // from req.query via requireEngineReadOrWrite middleware).
  router.use(processDefinitionsRoute);
  router.use(decisionsRoute);
  router.use(missionControlRoute);
  router.use(enginesAndFiltersRoute);
  router.use(batchesRoute);
  router.use(migrationRoute);
  router.use(directRoute);
  router.use(processInstancesRoute);
  router.use(tasksRoute);
  router.use(externalTasksRoute);
  router.use(messagesRoute);
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
  router.use(createNotificationsRouter({ tenantResolver: notificationTenantResolver }));
  router.use(dashboardStatsRoute);
  router.use(dashboardContextRoute);
  router.use('/api/identity/providers', (_req, res, next) => {
    res.locals.tenantIdentityProviderScope = true;
    next();
  });
  router.use(identityProvidersRoute);

  return router;
}

function createTenantIdentityProviderRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(resolveTenantContext({ required: true }));
  router.use((req, res, next) => {
    res.locals.tenantIdentityProviderScope = true;
    req.url = `/api${req.url}`;
    identityProvidersRoute(req, res, next);
  });
  return router;
}

/**
 * Register all application routes
 * 
 * Routes are organized into:
 * 1. Platform-level routes (auth, admin) - no tenant prefix
 * 2. Tenant-scoped routes - mounted under /t/:tenantSlug
 */
export function registerRoutes(app: Express, options: RegisterRoutesOptions = {}): void {
  const enterprisePluginLoaded = Boolean(app.locals?.enterprisePluginLoaded);
  // ============ Platform-Level Routes (no tenant prefix) ============

  // Directory-scoped machine API. The bearer credential, not a caller-supplied
  // tenant header, establishes the directory and tenant boundary.
  app.use(scimRoute);
  app.use(tenancyRoute);
  
  // Authentication routes
  app.use(loginRoute);
  app.use(logoutRoute);
  app.use(refreshRoute);
  app.use(passwordRoute);
  app.use(forgotPasswordRoute);
  app.use(meRoute);
  app.use(verifyEmailRoute);
  app.use(onboardingRoute);
  app.use(identityOidcRoute);
  app.use(ssoConfigRoute);
  app.use(invitationsRoute);

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
  if (config.tenancyMode !== 'pooled') app.use(identityProvidersRoute);
  app.use('/api/t/:tenantSlug', createTenantIdentityProviderRouter());
  app.use(identityMappingsRoute);
  app.use(identityProvisioningRoute);

  // Authorization API (platform-level)
  app.use(authzRoute);

  // Platform-level user management (for admin access without tenant prefix)
  app.use(usersRoute);

  // ============ Tenant-Scoped Routes ============
  // All routes below are accessible under /t/:tenantSlug/*
  // Example: /t/default/starbase-api/projects

  // Backward compatibility for clients that still call the root API paths.
  // The frontend can run on /t/:tenantSlug routes while older API clients still
  // request /starbase-api/*, /git-api/*, /mission-control-api/*, etc.
  // Root-shaped tenant APIs remain available in pooled mode only when the
  // request host itself resolves to a verified tenant hostname. The resolver
  // rejects the platform host, so this does not restore ambiguous root aliases.
  // Mount the explicit path authority first. In pooled mode, the root-shaped
  // compatibility router must not attempt hostname resolution for /t/:slug
  // requests before Express has populated the tenantSlug route parameter.
  app.use('/t/:tenantSlug', createTenantScopedRouter({
    includeAuditRoute: !enterprisePluginLoaded,
    notificationTenantResolver: options.notificationTenantResolver,
  }));

  app.use(createTenantScopedRouter({
    includeAuditRoute: !enterprisePluginLoaded,
    notificationTenantResolver: options.notificationTenantResolver,
  }));
}
