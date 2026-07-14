import type { Page, Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export type MockIdentityStackEvent = 'provider_listed' | 'authorization_started' | 'token_issued' | 'session_created' | 'membership_replayed';

/**
 * Browser-local identity stack for lifecycle tests. Protocol verification lives
 * in the backend mock-contract lane; this fixture owns browser redirects and
 * mutable membership state without publishing ports or credentials.
 */
export class MockBrowserIdentityStack {
  readonly provider = {
    id: 'browser-oidc-provider',
    key: 'identity.oidc.browser-mock',
    protocol: 'oidc' as const,
    isEnabled: true,
    authenticationMode: 'direct' as const,
    directoryTenantId: null,
    configurationJson: JSON.stringify({
      issuerUrl: 'https://identity-browser-mock.test',
      clientId: 'browser-lifecycle',
      callbackUrl: 'https://app.example.test/api/auth/identity/callback',
      scopes: ['openid', 'profile', 'email'],
    }),
    syncJson: JSON.stringify({ triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' }),
    ownershipMode: 'config_locked',
    sourceRef: 'config_bundle:e2e.identity.lifecycle',
  };

  readonly events: MockIdentityStackEvent[] = [];
  private authenticated = true;
  private externalSession = false;

  async install(page: Page, appOrigin: string): Promise<void> {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/t\/[^/]+(?=\/(?:api|engines-api|mission-control-api))/, '');

      if (path === '/api/auth/providers/enabled') {
        this.events.push('provider_listed');
        return json(route, [{ id: this.provider.id, key: this.provider.key, protocol: this.provider.protocol, loginMethod: 'redirect' }]);
      }
      if (path === `/api/auth/providers/${this.provider.id}/start`) {
        this.events.push('authorization_started', 'token_issued', 'session_created');
        this.authenticated = true;
        this.externalSession = true;
        return route.fulfill({ status: 302, headers: { location: `${appOrigin}/` } });
      }
      if (path === '/api/auth/me') {
        return this.authenticated
          ? json(route, {
            id: this.externalSession ? 'browser-external-user' : 'browser-admin-user',
            email: this.externalSession ? 'browser.user@example.test' : 'browser.admin@example.test',
            firstName: 'Browser', lastName: this.externalSession ? 'Identity' : 'Admin',
            platformRole: 'admin', authProvider: this.externalSession ? 'oidc' : 'local', isActive: true, isEmailVerified: true, mustResetPassword: false,
            createdAt: Date.now(), session: { principal: { type: 'user', id: this.externalSession ? 'browser-external-user' : 'browser-admin-user' }, tenant: { id: null } },
          })
          : json(route, { error: 'Not authenticated' }, 401);
      }
      if (path === '/api/auth/refresh') return json(route, { error: 'No refresh session' }, 401);
      if (path === '/api/authz/me/permissions' && this.authenticated) {
        return json(route, {
          userId: 'browser-external-user',
          platform: [
            'platform:dashboard:view', 'platform:settings:view', 'platform:settings:manage',
            'platform:authz:roles:view', 'platform:authz:roles:manage',
            'platform:sso-providers:view', 'platform:sso-providers:manage',
            'platform:sso-assignments:view', 'platform:sso-assignments:manage',
          ],
          projects: [], engines: [], generatedAt: Date.now(),
        });
      }
      if (path === '/api/dashboard/context') return json(route, { isPlatformAdmin: true, canViewActiveUsers: false, canViewEngines: false, canViewProcessData: false, canViewDeployments: false, canViewMetrics: false });
      if (path === '/api/dashboard/stats') return json(route, { totalProjects: 0, totalFiles: 0, fileTypes: { bpmn: 0, dmn: 0, form: 0 } });
      if (path === '/engines-api/engines' || path === '/api/users') return json(route, []);
      if (path === '/api/admin/settings') return json(route, { inviteAllowAllDomains: true, inviteAllowedDomains: [] });
      if (path === '/api/admin/environments' || path === '/api/admin/projects' || path === '/api/admin/engines') return json(route, []);
      if (path === '/api/sso/providers' || path === '/api/identity/providers/environment-migration-drafts') return json(route, []);
      if (path === '/api/identity/providers') return json(route, [this.provider]);
      if (path === `/api/identity/providers/${this.provider.key}/replay-memberships`) {
        this.events.push('membership_replayed');
        return json(route, { runId: 'browser-replay-run', scanned: 1, created: 1, removed: 0, failed: 0, truncated: false, nextCursor: null });
      }
      if (/^\/(?:api|engines-api|mission-control-api|git-api)\//.test(path)) {
        return json(route, { error: 'Not implemented by browser identity stack' }, 404);
      }

      return route.fallback();
    });
  }

  beginExternalLogin(): void {
    this.authenticated = false;
    this.externalSession = false;
  }
}
