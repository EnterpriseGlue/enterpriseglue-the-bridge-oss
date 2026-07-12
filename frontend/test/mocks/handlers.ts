import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/sso/providers/enabled', () => {
    return HttpResponse.json([
      { id: 'sso-1', name: 'Google', type: 'google' },
    ]);
  }),
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
