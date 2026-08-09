import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/index.js';

describe('backend authz route scanner', () => {
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
