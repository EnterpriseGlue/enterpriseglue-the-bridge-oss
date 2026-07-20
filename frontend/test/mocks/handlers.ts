import { http, HttpResponse } from 'msw';

export const identityProviderFixture = {
  id: 'identity-provider-1',
  key: 'demo-oidc',
  protocol: 'oidc',
  isEnabled: true,
  authenticationMode: 'claims_only',
  directoryTenantId: 'directory-tenant-1',
  configurationJson: JSON.stringify({
    issuerUrl: 'https://identity.example.test',
    clientId: 'enterpriseglue-client',
    callbackUrl: 'https://app.example.test/api/auth/identity/callback',
    scopes: ['openid', 'profile', 'email'],
  }),
  syncJson: JSON.stringify({ triggers: ['login'], requiredForLogin: true }),
  ownershipMode: 'manual',
  sourceRef: null,
};

export const identityMappingFixture = {
  id: 'identity-mapping-1',
  providerKey: 'demo-oidc',
  targetGroupKey: 'group.engine-operators',
  entitlementType: 'group',
  externalId: 'operations',
  matchOperator: 'exact',
  syncMode: 'authoritative',
  isActive: true,
  sourceRef: null,
};

export function identityApiFailureHandlers(message = 'Identity provider unavailable') {
  return [
    http.get('/api/identity/providers', () => HttpResponse.text(message, { status: 503 })),
    http.get('/api/identity/mappings', () => HttpResponse.text(message, { status: 503 })),
  ];
}

export const handlers = [
  http.get('/api/auth/providers/enabled', () => HttpResponse.json([])),
  http.get('/api/auth/branding', () => {
    return HttpResponse.json({});
  }),
  http.get('/api/auth/platform-settings', () => {
    return HttpResponse.json({
      syncPushEnabled: true,
      syncPullEnabled: false,
      gitProjectTokenSharingEnabled: false,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
      engineOnboardingMode: 'manual_allowed',
      projectEngineTargetMode: 'manual_allowed',
      engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
    });
  }),
  http.get('/api/identity/providers', () => HttpResponse.json([identityProviderFixture])),
  http.get('/api/identity/providers/:key/sync-runs', () => HttpResponse.json([])),
  http.post('/api/identity/providers/:key/test-connection', () => HttpResponse.json({ status: 'connected', protocol: 'oidc', issuer: 'https://identity.example.test' })),
  http.post('/api/identity/providers/:key/reconciliation-preview', () => HttpResponse.json({ scanned: 1, additions: 0, removals: 0, unchanged: 1, failed: 0, truncated: false, nextCursor: null, latestSnapshotAt: 1, warnings: [] })),
  http.post('/api/identity/providers/:key/replay-memberships', () => HttpResponse.json({ runId: 'sync-run-1', scanned: 1, created: 0, removed: 0, failed: 0, truncated: false, nextCursor: null })),
  http.post('/api/identity/providers/:key/reconcile', () => HttpResponse.json({ status: 'queued' })),
  http.post('/api/identity/providers', () => HttpResponse.json(identityProviderFixture, { status: 201 })),
  http.put('/api/identity/providers/:key', () => HttpResponse.json(identityProviderFixture)),
  http.delete('/api/identity/providers/:key', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/identity/mappings', () => HttpResponse.json([identityMappingFixture])),
  http.post('/api/identity/mappings', () => HttpResponse.json(identityMappingFixture, { status: 201 })),
  http.put('/api/identity/mappings/:id', () => HttpResponse.json(identityMappingFixture)),
  http.delete('/api/identity/mappings/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/identity/mappings/test', () => HttpResponse.json({ matches: true, entitlements: [{ type: 'group', externalId: 'operations' }] })),
  http.post('/api/identity/mappings/stored-snapshot-preview', () => HttpResponse.json({ scanned: 1, matches: 1, nonMatches: 0, failed: 0, truncated: false, warnings: [] })),
  http.get('/api/authz/groups', () => HttpResponse.json([{ id: 'group-1', key: 'group.engine-operators', name: 'Engine operators', isArchived: false }])),
  http.get('/api/authz/config-bundles/runs', () => HttpResponse.json([])),
  http.post('/api/authz/config-bundles/preview', () => HttpResponse.json({ valid: true, canonicalHash: 'preview-hash', errors: [], counts: {} })),
  http.post('/api/authz/config-bundles/diff', () => HttpResponse.json({ valid: true, canonicalHash: 'preview-hash', errors: [], counts: {}, changes: [], warnings: [], requiredAcknowledgements: [], affectedPrincipals: { affectedGroupCount: 0, affectedUserCount: 0, externalIdentityMappingChangeCount: 0 } })),
  http.post('/api/authz/config-bundles/validate-secret-refs', () => HttpResponse.json({ valid: true, canonicalHash: 'preview-hash', availabilityHash: 'availability-hash', available: true, errors: [], references: [] })),
  http.post('/api/authz/config-bundles/apply', () => HttpResponse.json({ reconciliation: { engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0, identitySnapshot: { mode: 'apply', status: 'completed', providerCount: 0, scanned: 0, created: 0, removed: 0, failed: 0 } } })),
  http.get('/starbase-api/projects', () => {
    return HttpResponse.json([
      {
        id: 'project-1',
        name: 'Alpha Project',
        createdAt: Date.now(),
        foldersCount: 0,
        filesCount: 0,
        gitUrl: null,
        gitProviderType: null,
        gitSyncStatus: null,
        members: [],
      },
    ]);
  }),
  http.get('/t/default/starbase-api/projects', () => {
    return HttpResponse.json([
      {
        id: 'project-1',
        name: 'Alpha Project',
        createdAt: Date.now(),
        foldersCount: 0,
        filesCount: 0,
        gitUrl: null,
        gitProviderType: null,
        gitSyncStatus: null,
        members: [],
      },
    ]);
  }),
  http.get('/vcs-api/projects/uncommitted-status', () => {
    return HttpResponse.json({ statuses: {} });
  }),
  http.get('/t/default/vcs-api/projects/uncommitted-status', () => {
    return HttpResponse.json({ statuses: {} });
  }),
  http.get('/git-api/providers', () => {
    return HttpResponse.json([]);
  }),
  http.get('/t/default/git-api/providers', () => {
    return HttpResponse.json([]);
  }),
  http.get('/git-api/credentials', () => {
    return HttpResponse.json([]);
  }),
  http.get('/t/default/git-api/credentials', () => {
    return HttpResponse.json([]);
  }),
  http.get('/engines-api/saved-filters', () => {
    return HttpResponse.json([]);
  }),
  http.get('/t/default/engines-api/saved-filters', () => {
    return HttpResponse.json([]);
  }),
  http.post('/engines-api/saved-filters', async () => {
    return HttpResponse.json({ id: 'saved-filter-1', name: 'Saved filter' });
  }),
  http.post('/t/default/engines-api/saved-filters', async () => {
    return HttpResponse.json({ id: 'saved-filter-1', name: 'Saved filter' });
  }),
  http.delete('/engines-api/saved-filters/:id', () => {
    return HttpResponse.json({ success: true });
  }),
  http.delete('/t/default/engines-api/saved-filters/:id', () => {
    return HttpResponse.json({ success: true });
  }),
  http.post('/api/notifications', async () => {
    return HttpResponse.json({ ok: true });
  }),
  http.get('/t/default/api/notifications', () => {
    return HttpResponse.json({ notifications: [], unreadCount: 0 });
  }),
  http.patch('/t/default/api/notifications/read', () => {
    return HttpResponse.json({ success: true });
  }),
  http.delete('/t/default/api/notifications', () => {
    return HttpResponse.json({ success: true });
  }),
];
