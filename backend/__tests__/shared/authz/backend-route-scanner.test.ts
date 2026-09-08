import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/index.js';

describe('backend authz route scanner', () => {
  it('covers service-account scope factories and their local workload aliases', () => {
    const result = scanBackendAuthzRoutes([{
      filePath: 'workloads.ts',
      content: `
        const workloadScope = requireServiceAccountScope(ServiceAccountScopes.TENANT_LIFECYCLE);
        router.post('/api/workloads/tenants/:tenantId/managed-engines', workloadScope, handler);
        router.post('/api/workloads/tenants/:tenantId/managed-engines/:engineRef/decommission', workloadScope, handler);
        router.post('/api/workloads/unregistered', requireServiceAccountScope('other'), handler);
      `,
    }, {
      filePath: 'unrelated.ts',
      content: `router.get('/health', workloadScope, handler);`,
    }]);
    expect(result.authenticatedRoutes).toHaveLength(3);
    expect(result.registeredAuthenticatedRoutes.map((route) => route.registeredActionIds)).toEqual([
      ['platform.tenants.workload.managed-engines.register'],
      ['platform.tenants.workload.managed-engines.decommission'],
    ]);
    expect(result.uncoveredAuthenticatedRoutes.map((route) => route.route)).toEqual(['/api/workloads/unregistered']);
    expect(result.routes.find((route) => route.route === '/health')?.authenticated).toBe(false);
  });

  it('inherits service-account authentication from a scoped router alias', () => {
    const result = scanBackendAuthzRoutes([{
      filePath: 'workloads.ts',
      content: `
        const guard = requireServiceAccountScope('tenant:lifecycle');
        router.use('/api/workloads', guard);
        router.get('/api/workloads/unregistered', handler);
      `,
    }]);
    expect(result.uncoveredAuthenticatedRoutes).toHaveLength(1);
  });

  it('detects authenticated registered routes and open routes from inline middleware', () => {
    const result = scanBackendAuthzRoutes([{
      filePath: 'routes.ts',
      content: `
        const r = Router();
        r.get('/health', (_req, res) => res.json({ ok: true }));
        r.get('/engines-api/engines/:engineId/deployments', apiLimiter, requireAuth, requireAction('engine.deployments.read'), asyncHandler(handler));
      `,
    }]);

    expect(result.routes).toHaveLength(2);
    expect(result.authenticatedRoutes).toHaveLength(1);
    expect(result.registeredAuthenticatedRoutes).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/engines-api/engines/:engineId/deployments',
        registeredActionIds: ['engine.deployments.read'],
      }),
    ]);
    expect(result.unregisteredAuthenticatedRoutes).toEqual([]);
  });

  it('inherits authentication from router.use(requireAuth)', () => {
    const result = scanBackendAuthzRoutes([{
      filePath: 'mission-control.ts',
      content: `
        const r = Router();
        r.use(requireAuth);
        r.get('/mission-control-api/tasks', requireEngineReadOrWrite({ permission: EnginePermissions.INSTANCE_VIEW }), asyncHandler(handler));
      `,
    }]);

    expect(result.authenticatedRoutes).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/mission-control-api/tasks',
        authenticated: true,
        registeredActionIds: ['engine.runtime.tasks.read'],
      }),
    ]);
    expect(result.registeredAuthenticatedRoutes).toHaveLength(1);
    expect(result.unregisteredAuthenticatedRoutes).toHaveLength(0);
  });

  it('recognizes the bounded Cloud-account-or-tenant authentication middleware', () => {
    const result = scanBackendAuthzRoutes([
      {
        filePath: 'cloud.ts',
        content: `
          const r = Router();
          r.get('/api/auth/me', requireCloudAccountOrTenantAuth, asyncHandler(handler));
        `,
      },
    ]);

    expect(result.routes[0]).toMatchObject({
      route: '/api/auth/me',
      authenticated: true,
      authMiddleware: ['requireCloudAccountOrTenantAuth'],
    });
  });

  it('treats explicit auth-only exemptions as covered without action registration', () => {
    const result = scanBackendAuthzRoutes([{
      filePath: 'auth.ts',
      content: `
        const r = Router();
        r.get('/api/auth/me', requireAuth, asyncHandler(handler));
        r.get('/api/non-exempt', requireAuth, asyncHandler(handler));
      `,
    }]);

    expect(result.exemptAuthenticatedRoutes).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/api/auth/me',
        registeredActionIds: [],
        exemption: expect.objectContaining({ kind: 'auth-only' }),
      }),
    ]);
    expect(result.coveredAuthenticatedRoutes).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/api/auth/me',
      }),
    ]);
    expect(result.uncoveredAuthenticatedRoutes).toEqual([
        expect.objectContaining({
          method: 'GET',
          route: '/api/non-exempt',
        }),
      ]);
    expect(result.unregisteredAuthenticatedRoutes).toBe(result.uncoveredAuthenticatedRoutes);
  });

  it('inherits authentication from prefixed router.use when the route path matches the prefix', () => {
    const result = scanBackendAuthzRoutes([{
      filePath: 'metrics.ts',
      content: `
        const r = Router();
        r.use('/mission-control-api', requireAuth, requireEngineReadOrWrite({ permission: EnginePermissions.INSTANCE_VIEW }));
        r.get('/mission-control-api/metrics', validateQuery(schema), asyncHandler(handler));
        r.get('/public/metadata', asyncHandler(handler));
      `,
    }]);

    expect(result.authenticatedRoutes).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/mission-control-api/metrics',
        authenticated: true,
      }),
    ]);
    expect(result.routes.find((route) => route.route === '/public/metadata')?.authenticated).toBe(false);
  });

  it('ignores non-route calls that use HTTP method names without a string path', () => {
    const result = scanBackendAuthzRoutes([{
      filePath: 'repository.ts',
      content: `
        await repository.delete({ id });
        router.post('/api/authz/evaluate', requireAuth, requireAction('platform.authz.evaluate'), asyncHandler(handler));
      `,
    }]);

    expect(result.routes).toEqual([
      expect.objectContaining({
        method: 'POST',
        route: '/api/authz/evaluate',
        registeredActionIds: ['platform.authz.evaluate'],
      }),
    ]);
  });
});
