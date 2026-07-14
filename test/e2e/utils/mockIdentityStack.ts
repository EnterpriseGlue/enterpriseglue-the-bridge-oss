import type { Page, Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export type MockIdentityStackEvent = 'provider_listed' | 'authorization_started' | 'token_issued' | 'session_created' | 'connection_tested' | 'membership_previewed' | 'membership_replayed' | 'mapping_tested' | 'mapping_previewed';

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
  private connectionFailurePending = false;

  readonly mapping = {
    id: 'browser-identity-mapping',
    providerKey: this.provider.key,
    targetGroupKey: 'group.browser-operators',
    entitlementType: 'group' as const,
    externalId: 'operators',
    matchOperator: 'exact' as const,
    syncMode: 'authoritative' as const,
    isActive: true,
    sourceRef: null,
  };

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
      if (path === `/api/identity/providers/${this.provider.key}/test-connection`) {
        this.events.push('connection_tested');
        if (this.connectionFailurePending) {
          this.connectionFailurePending = false;
          return json(route, { error: 'Provider connection could not be verified', internalDetail: 'client_secret=browser-stack-secret' }, 502);
        }
        return json(route, { status: 'connected', protocol: 'oidc', issuer: 'https://identity-browser-mock.test' });
      }
      if (path === `/api/identity/providers/${this.provider.key}/reconciliation-preview`) {
        this.events.push('membership_previewed');
        return json(route, { scanned: 3, additions: 1, removals: 1, unchanged: 1, failed: 0, truncated: false, nextCursor: null, latestSnapshotAt: Date.now(), warnings: [] });
      }
      if (path === `/api/identity/providers/${this.provider.key}/sync-runs`) {
        return json(route, [{ id: 'browser-sync-run', providerKey: this.provider.key, trigger: 'login', status: 'completed', startedAt: Date.now() - 1_000, completedAt: Date.now(), identitiesScanned: 3, groupMembershipsCreated: 1, groupMembershipsRemoved: 1, errorMessage: null }]);
      }
      if (path === `/api/identity/providers/${this.provider.key}/replay-memberships`) {
        this.events.push('membership_replayed');
        return json(route, { runId: 'browser-replay-run', scanned: 1, created: 1, removed: 0, failed: 0, truncated: false, nextCursor: null });
      }
      if (path === '/api/identity/mappings') return json(route, [this.mapping]);
      if (path === '/api/identity/mappings/test') {
        this.events.push('mapping_tested');
        return json(route, { matches: true, entitlements: [{ type: 'group', externalId: 'operators' }] });
      }
      if (path === '/api/identity/mappings/stored-snapshot-preview') {
        this.events.push('mapping_previewed');
        return json(route, { scanned: 3, matches: 2, nonMatches: 1, failed: 0, truncated: false, warnings: [] });
      }
      if (path === '/api/authz/groups') return json(route, [{ id: 'browser-group', key: 'group.browser-operators', name: 'Browser operators', isArchived: false }]);
      if (path === '/api/authz/roles' || path === '/api/authz/engine-sets' || path === '/api/authz/legacy-mapping-coverage') return json(route, []);
      if (path === '/api/authz/legacy-mapping-retirement-readiness') return json(route, { ready: true, activeLegacyMappingCount: 0, verifiedReplacementCount: 0, blockers: [] });
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

  failNextConnectionTest(): void {
    this.connectionFailurePending = true;
  }
}
