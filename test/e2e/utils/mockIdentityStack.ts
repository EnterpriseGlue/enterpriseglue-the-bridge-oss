import type { Page, Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export type MockIdentityStackEvent = 'provider_listed' | 'authorization_started' | 'token_issued' | 'session_created' | 'connection_tested' | 'membership_previewed' | 'membership_replayed' | 'mapping_tested' | 'mapping_previewed' | 'external_identity_unlinked';

/**
 * Browser-local identity stack for lifecycle tests. Protocol verification lives
 * in the backend mock-contract lane; this fixture owns browser redirects and
 * mutable membership state without publishing ports or credentials.
 */
export class MockBrowserIdentityStack {
  readonly provider = {
    id: 'browser-oidc-provider',
    key: 'identity.oidc.browser-mock',
    displayName: 'Browser identity provider',
    organization: 'EnterpriseGlue test' as string | null,
    displayOrder: 0,
    isPreferred: true,
    loginDomainsJson: JSON.stringify(['example.test']),
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
    providerId: this.provider.id,
    providerKey: this.provider.key,
    targetGroupId: 'browser-group',
    targetGroupKey: 'group.browser-operators',
    entitlementType: 'group' as 'group' | 'role' | 'attribute' | 'authenticated',
    externalId: 'operators' as string | null,
    matchOperator: 'exact' as 'exact' | 'contains' | 'prefix' | 'regex' | 'exists',
    syncMode: 'authoritative' as 'authoritative' | 'additive',
    isActive: true,
    configKey: null,
    sourceRef: null as string | null,
    ownershipMode: 'manual' as 'manual' | 'config_warn' | 'config_locked',
  };

  async install(page: Page, appOrigin: string): Promise<void> {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname
        .replace(/^\/api\/t\/[^/]+\/auth/, '/api/auth')
        .replace(/^\/t\/[^/]+(?=\/(?:api|engines-api|mission-control-api))/, '');

      if (path === '/api/auth/login-methods') {
        this.events.push('provider_listed');
        const providers = this.provider.isEnabled ? [{
          id: this.provider.id,
          key: this.provider.key,
          displayName: this.provider.displayName,
          organization: this.provider.organization,
          protocol: this.provider.protocol,
          loginMethod: 'redirect',
          preferred: true,
          loginDomains: ['example.test'],
        }] : [];
        return json(route, {
          localPassword: { enabled: providers.length === 0 },
          providerSelection: 'chooser',
          autoRedirectProviderId: null,
          providers,
          configurationStatus: 'ready',
        });
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
        const currentUserId = this.externalSession ? 'browser-external-user' : 'browser-admin-user';
        return json(route, {
          // Permission snapshots are bound to the authenticated session. Keeping
          // this fixture aligned with the session contract ensures it exercises
          // the same fail-closed stale-snapshot protection as the real client.
          userId: currentUserId,
          tenantId: null,
          platform: [
            'platform:dashboard:view', 'platform:settings:view', 'platform:settings:manage',
            'platform:authz:roles:view', 'platform:authz:roles:manage',
            'platform:authz:permissions:view', 'platform:authz:assignments:view',
            'platform:authz:assignments:create', 'platform:authz:assignments:delete',
            'platform:authz:groups:view', 'platform:authz:groups:manage',
            'platform:authz:check', 'platform:authz:policies:view', 'platform:authz:policies:manage',
            'platform:engine-sets:view', 'platform:engine-sets:manage',
            'platform:project-engine-targets:view', 'platform:project-engine-targets:manage',
            'platform:audit:view',
            'platform:config-bundles:view', 'platform:config-bundles:preview',
            'platform:config-bundles:apply', 'platform:config-bundles:export',
            'platform:sso-providers:view', 'platform:sso-providers:manage',
            'platform:sso-assignments:view', 'platform:sso-assignments:manage',
            'platform:users:view', 'platform:users:create', 'platform:users:update',
            'platform:users:deactivate', 'platform:users:unlock',
          ],
          projects: [], engines: [], generatedAt: Date.now(),
          authorizationVersion: 'browser-authz-v1',
        });
      }
      if (path === '/api/dashboard/context') return json(route, { isPlatformAdmin: true, canViewActiveUsers: false, canViewEngines: false, canViewProcessData: false, canViewDeployments: false, canViewMetrics: false });
      if (path === '/api/dashboard/stats') return json(route, { totalProjects: 0, totalFiles: 0, fileTypes: { bpmn: 0, dmn: 0, form: 0 } });
      if (path === '/api/t/default/invitations/capabilities' || path === '/api/invitations/capabilities') {
        return json(route, { ssoRequired: true, emailConfigured: true });
      }
      const directoryUsers = [
        {
          id: 'browser-directory-user', email: 'ada.lovelace@example.test', firstName: 'Ada', lastName: 'Lovelace', displayName: 'Ada Lovelace',
          status: 'active', platformRole: 'user', authenticationSources: ['oidc'], provisioningSource: 'scim',
          provisioningDirectoryKey: 'entra-workforce', lastSignInAt: Date.UTC(2026, 7, 14, 8, 30),
          lastProvisionedAt: Date.UTC(2026, 7, 14, 8, 15), provisioningHealth: 'healthy',
        },
        {
          id: 'browser-jit-user', email: 'grace.hopper@example.test', firstName: 'Grace', lastName: 'Hopper', displayName: 'Grace Hopper',
          status: 'active', platformRole: 'admin', authenticationSources: ['saml'], provisioningSource: 'jit',
          provisioningDirectoryKey: null, lastSignInAt: Date.UTC(2026, 7, 13, 16, 45), lastProvisionedAt: null, provisioningHealth: 'not_applicable',
        },
        {
          id: 'browser-admin-user', email: 'browser.admin@example.test', firstName: 'Browser', lastName: 'Admin', displayName: 'Browser Admin',
          status: 'active', platformRole: 'admin', authenticationSources: ['local', 'recovery'], provisioningSource: 'none',
          provisioningDirectoryKey: null, lastSignInAt: Date.UTC(2026, 7, 14, 9, 0), lastProvisionedAt: null, provisioningHealth: 'not_applicable',
        },
        {
          id: 'browser-suspended-user', email: 'former.employee@example.test', firstName: 'Former', lastName: 'Employee', displayName: 'Former Employee',
          status: 'deactivated', platformRole: 'user', authenticationSources: ['none'], provisioningSource: 'scim',
          provisioningDirectoryKey: 'entra-workforce', lastSignInAt: null, lastProvisionedAt: Date.UTC(2026, 7, 12, 12, 0), provisioningHealth: 'warning',
        },
      ];
      if (path === '/api/users/directory') return json(route, { items: directoryUsers, total: directoryUsers.length, limit: 200, offset: 0 });
      if (path === '/api/users/browser-directory-user/identity-context') return json(route, {
        user: directoryUsers[0],
        linkedIdentities: [
          { id: 'linked-idp-1', sourceType: 'identity_provider', sourceKey: 'identity.oidc.browser-mock', sourceName: 'Microsoft Entra ID', externalSubject: 'entra:ada-lovelace', status: 'active', linkedAt: Date.UTC(2026, 6, 1), lastSeenAt: Date.UTC(2026, 7, 14, 8, 30) },
          { id: 'linked-scim-1', sourceType: 'provisioning_directory', sourceKey: 'entra-workforce', sourceName: 'Microsoft Entra workforce', externalSubject: '00u-ada-lovelace', status: 'active', linkedAt: Date.UTC(2026, 6, 1), lastSeenAt: Date.UTC(2026, 7, 14, 8, 15) },
        ],
        fieldOwnership: [
          { field: 'email', owner: 'directory', sourceKey: 'entra-workforce' },
          { field: 'firstName', owner: 'directory', sourceKey: 'entra-workforce' },
          { field: 'lastName', owner: 'directory', sourceKey: 'entra-workforce' },
          { field: 'displayName', owner: 'directory', sourceKey: 'entra-workforce' },
          { field: 'active', owner: 'directory', sourceKey: 'entra-workforce' },
        ],
        recoveryAdministrator: false,
      });
      if (path === '/api/users/browser-directory-user/effective-access') return json(route, {
        userId: 'browser-directory-user', platformRole: 'user', evaluatedAt: Date.UTC(2026, 7, 14, 9, 5),
        lineage: [
          { sourceType: 'directory_mapping', sourceId: 'map-finance', sourceName: 'Entra Finance operators', assignmentType: 'group', assignmentId: 'group-finance', assignmentName: 'Finance operators', active: true },
          { sourceType: 'directory_mapping', sourceId: 'map-process-viewer', sourceName: 'Entra workforce role mapping', assignmentType: 'role', assignmentId: 'role-process-viewer', assignmentName: 'Process viewer', active: true },
          { sourceType: 'configuration', sourceId: 'config:baseline', sourceName: 'Platform baseline', assignmentType: 'platform_role', assignmentId: 'user', assignmentName: 'Standard user', active: true },
        ],
      });
      if (path === '/api/users/browser-directory-user/sessions') return json(route, {
        userId: 'browser-directory-user', sessions: [
          { id: 'session-browser-1', createdAt: Date.UTC(2026, 7, 14, 8, 30), lastUsedAt: Date.UTC(2026, 7, 14, 9, 2), expiresAt: Date.UTC(2026, 7, 21, 8, 30), revokedAt: null, authenticationSource: 'oidc', ipAddress: '192.0.2.44', userAgent: 'Chrome on managed macOS' },
        ],
      });
      if (path === '/api/users/browser-directory-user/audit') return json(route, {
        userId: 'browser-directory-user', events: [
          { id: 'audit-browser-1', action: 'identity.provisioning.user.update', outcome: 'success', actorId: null, sourceType: 'scim', reason: 'Directory profile reconciliation', occurredAt: Date.UTC(2026, 7, 14, 8, 15) },
          { id: 'audit-browser-2', action: 'auth.login.success', outcome: 'success', actorId: 'browser-directory-user', sourceType: 'oidc', reason: 'Enterprise SSO', occurredAt: Date.UTC(2026, 7, 14, 8, 30) },
        ],
      });
      if (/^\/api\/users\/browser-directory-user\/(?:deactivate|reactivate|revoke-sessions)$/.test(path) && request.method() === 'POST') {
        const action = path.split('/').pop();
        return json(route, { userId: 'browser-directory-user', status: action === 'deactivate' ? 'deactivated' : 'active', authSessionVersion: 2, changedAt: Date.now() });
      }
      const provisioningDirectory = {
        id: 'browser-directory-1', tenantId: null, key: 'entra-workforce', directoryKeyIdentity: 'global:entra-workforce',
        displayName: 'Microsoft Entra workforce', description: 'Authoritative employee and group lifecycle', type: 'scim_v2',
        identityProviderKey: 'identity.oidc.browser-mock', authoritative: true, status: 'active', ownershipMode: 'manual',
        sourceRef: null, sourceHash: null, credentialSecretRef: null, lastAppliedAt: null, driftStatus: null,
        createdAt: Date.UTC(2026, 6, 1), updatedAt: Date.UTC(2026, 7, 14, 8, 15), archivedAt: null,
      };
      const provisioningCredentials = [{
        id: 'browser-scim-credential', directoryId: provisioningDirectory.id, name: 'Entra production', fingerprint: 'sha256:75e4a84f1a62',
        status: 'active', createdAt: Date.UTC(2026, 6, 1), expiresAt: Date.UTC(2027, 0, 1), overlapEndsAt: null,
        lastUsedAt: Date.UTC(2026, 7, 14, 8, 15), revokedAt: null,
      }];
      if (path === '/api/identity/provisioning-directories' && request.method() === 'GET') return json(route, { items: [provisioningDirectory], total: 1, limit: 200, offset: 0 });
      if (path === '/api/identity/provisioning-directories/entra-workforce/credentials' && request.method() === 'GET') return json(route, { items: provisioningCredentials });
      if (path === '/api/identity/provisioning-directories/entra-workforce/credentials' && request.method() === 'POST') return json(route, {
        credential: { ...provisioningCredentials[0], id: 'browser-new-credential', name: 'Directory provisioning', fingerprint: 'sha256:1d423f9940bb', lastUsedAt: null },
        clientId: 'browser-new-credential',
        token: 'eg_scim_7bd083f6d75a4b6dbaf3_reveal_once',
        tokenEndpointPath: '/scim/v2/entra-workforce/oauth/token',
      }, 201);
      if (path === '/api/identity/provisioning-directories/entra-workforce/events') return json(route, { items: [
        { id: 'diag-1', directoryId: provisioningDirectory.id, requestId: 'req-20260814-001', eventType: 'User.patch', resourceType: 'User', resourceId: '00u-ada-lovelace', userId: 'browser-directory-user', status: 'success', code: null, message: 'User attributes reconciled', occurredAt: Date.UTC(2026, 7, 14, 8, 15) },
        { id: 'diag-2', directoryId: provisioningDirectory.id, requestId: 'req-20260814-002', eventType: 'Group.membership.replace', resourceType: 'Group', resourceId: 'finance-operators', userId: null, status: 'success', code: null, message: 'Group membership synchronized', occurredAt: Date.UTC(2026, 7, 14, 8, 16) },
      ] });
      if (path === '/api/identity/provisioning-directories/entra-workforce/test' && request.method() === 'POST') return json(route, { status: 'ready', directoryStatus: 'active', activeCredentialCount: 1, endpointPath: '/scim/v2/entra-workforce' });
      if (path === '/engines-api/engines' || path === '/api/users') return json(route, []);
      if (path === '/api/admin/settings') return json(route, {
        inviteAllowAllDomains: true,
        inviteAllowedDomains: [],
        localPasswordLoginMode: 'auto',
        ssoProviderSelectionMode: 'auto_redirect_single',
      });
      if (path === '/api/admin/environments' || path === '/api/admin/projects' || path === '/api/admin/engines') return json(route, []);
      if (path === '/api/sso/providers' || path === '/api/identity/providers/environment-migration-drafts') return json(route, []);
      if (path === '/api/identity/providers' && request.method() === 'GET') return json(route, [this.provider]);
      if (path === '/api/identity/providers' && request.method() === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>;
        if (typeof body.key === 'string') this.provider.key = body.key;
        if (typeof body.displayName === 'string') this.provider.displayName = body.displayName;
        if (typeof body.organization === 'string' || body.organization === null) this.provider.organization = body.organization as string | null;
        if (typeof body.isEnabled === 'boolean') this.provider.isEnabled = body.isEnabled;
        if (body.authenticationMode === 'direct' || body.authenticationMode === 'claims_only') this.provider.authenticationMode = body.authenticationMode;
        if (body.configuration && typeof body.configuration === 'object') this.provider.configurationJson = JSON.stringify(body.configuration);
        if (body.sync && typeof body.sync === 'object') this.provider.syncJson = JSON.stringify(body.sync);
        return json(route, this.provider, 201);
      }
      if (path === `/api/identity/providers/${this.provider.key}` && request.method() === 'PUT') {
        const body = request.postDataJSON() as Partial<typeof this.provider>;
        if (typeof body.isEnabled === 'boolean') this.provider.isEnabled = body.isEnabled;
        if (body.authenticationMode === 'direct' || body.authenticationMode === 'claims_only') this.provider.authenticationMode = body.authenticationMode;
        return json(route, this.provider);
      }
      if (path === `/api/identity/providers/${this.provider.key}` && request.method() === 'DELETE') {
        this.provider.isEnabled = false;
        return route.fulfill({ status: 204 });
      }
      if (path === `/api/identity/providers/${this.provider.key}/external-identities/unlink`) {
        this.events.push('external_identity_unlinked');
        return json(route, { providerManagedMembershipsRemoved: 1, providerRefreshSessionsRevoked: 1 });
      }
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
      if (path === '/api/identity/mappings' && request.method() === 'GET') return json(route, [this.mapping]);
      if (path === '/api/identity/mappings' && request.method() === 'POST') {
        const body = request.postDataJSON() as Partial<typeof this.mapping>;
        if (typeof body.providerKey === 'string') this.mapping.providerKey = body.providerKey;
        if (typeof body.targetGroupKey === 'string') this.mapping.targetGroupKey = body.targetGroupKey;
        if (body.entitlementType) this.mapping.entitlementType = body.entitlementType;
        if (typeof body.externalId === 'string' || body.externalId === null) this.mapping.externalId = body.externalId;
        if (body.matchOperator) this.mapping.matchOperator = body.matchOperator;
        if (body.syncMode) this.mapping.syncMode = body.syncMode;
        return json(route, this.mapping, 201);
      }
      if (path === `/api/identity/mappings/${this.mapping.id}` && request.method() === 'PUT') {
        const body = request.postDataJSON() as Partial<typeof this.mapping>;
        if (typeof body.isActive === 'boolean') this.mapping.isActive = body.isActive;
        return json(route, this.mapping);
      }
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

  makeProviderManual(): void {
    this.provider.ownershipMode = 'manual';
    this.provider.sourceRef = null;
  }
}
