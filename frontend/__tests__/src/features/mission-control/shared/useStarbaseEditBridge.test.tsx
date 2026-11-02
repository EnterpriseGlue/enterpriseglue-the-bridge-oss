import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@src/contexts/AuthContext';
import { apiClient } from '@src/shared/api/client';
import { useStarbaseEditBridge, type StarbaseEditSelection } from '@src/features/mission-control/shared/useStarbaseEditBridge';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
const navigation = vi.hoisted(() => ({ go: vi.fn(), slug: 'tenant-a', pathname: '/mission-control/processes', search: '?process=invoice&version=3' }));
vi.mock('@src/shared/hooks/useTenantNavigate', () => ({ useTenantNavigate: () => ({ tenantNavigate: navigation.go, tenantSlug: navigation.slug, effectivePathname: navigation.pathname }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: navigation.pathname, search: navigation.search }) }));
vi.mock('@src/shared/api/client', async importOriginal => ({ ...await importOriginal<typeof import('@src/shared/api/client')>(), apiClient: { post: vi.fn() } }));
let auth: any;
const processTarget = () => ({ canShowEditButton: true, canEdit: true, engineId: 'engine-1', projectId: 'project-1', fileId: 'file-1', processKey: 'invoice', processVersion: 3, engineDeploymentId: 'deployment-3', commitId: 'commit-3', fileVersionNumber: 2, mappingSource: 'git-commit' });
function allowance(body: any) { return { allowed: true, reasonCode: 'allowed', reason: 'Allowed', missingActions: [], engineId: body.engineId, projectId: body.projectId, fileId: body.fileId, targetId: 'target-1', lineage: { kind: body.kind, definitionId: body.definitionId, definitionKey: body.definitionKey, decisionDefinitionId: body.decisionDefinitionId, decisionDefinitionKey: body.decisionDefinitionKey } }; }
function fixture(overrides: Partial<StarbaseEditSelection> = {}) {
  const selection: StarbaseEditSelection = { engineId: 'engine-1', kind: 'process', definitionKey: 'invoice', definitionId: 'invoice:3:def', version: 3, editTarget: processTarget(), viewKey: 'overview', ...overrides };
  const f = renderHook(props => useStarbaseEditBridge(props), { initialProps: selection, wrapper: ({ children }) => <AuthContext.Provider value={auth}>{children}</AuthContext.Provider> });
  return { ...f, selection };
}
describe('source-bound Starbase edit handoff', () => {
  beforeEach(() => { vi.resetAllMocks(); navigation.slug = 'tenant-a'; navigation.pathname = '/mission-control/processes'; navigation.search = '?process=invoice&version=3'; auth = { user: { id: 'actor-a' }, isAuthenticated: true, sessionRevision: 1, permissions: { userId: 'actor-a', platform: [], projects: [], engines: [], generatedAt: 1 } }; });
  it('uses the exact process selection once and preserves all retained source selectors', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (_url, body) => allowance(body)); const f = fixture();
    await act(async () => { await Promise.all([f.result.current.open(), f.result.current.open()]); });
    expect(apiClient.post).toHaveBeenCalledOnce(); expect(navigation.go).toHaveBeenCalledExactlyOnceWith('/starbase/editor/file-1?source=mission-control&engineId=engine-1&process=invoice&version=3&deploymentId=deployment-3&mappingSource=git-commit&commitId=commit-3&fileVersion=2');
  });
  it('binds decision IDs and keys and does not invent missing commit or file-version selectors', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (_url, body) => allowance(body)); const { processKey: _key, processVersion: _version, ...base } = processTarget();
    const f = fixture({ kind: 'decision', editTarget: { ...base, decisionKey: 'invoice', decisionVersion: 3, commitId: null, fileVersionNumber: null } }); await act(async () => f.result.current.open());
    expect(apiClient.post).toHaveBeenCalledWith('/api/mission-control/bridge/starbase-edit/evaluate', expect.objectContaining({ kind: 'decision', definitionId: 'invoice:3:def', decisionDefinitionId: 'invoice:3:def', decisionDefinitionKey: 'invoice' }));
    expect(String(navigation.go.mock.calls[0][0])).toContain('decision=invoice'); expect(String(navigation.go.mock.calls[0][0])).not.toMatch(/commitId|fileVersion/);
  });
  it.each(['engine', 'version', 'version-aba', 'file', 'commit', 'file-version', 'actor', 'permission', 'tenant-url', 'route', 'search', 'view', 'read-only', 'refetch', 'browser', 'unmount'])('drops a pending allowance after %s changes', async change => {
    let finish!: () => void; vi.mocked(apiClient.post).mockImplementation((_url, body) => new Promise(resolve => { finish = () => resolve(allowance(body)); }));
    const f = fixture(); let pending!: Promise<void>; act(() => { pending = f.result.current.open(); }); await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
    const target = { ...(f.selection.editTarget as any) };
    if (change === 'browser') advanceBrowserSessionRevision();
    else if (change === 'unmount') f.unmount();
    else {
      let selected = { ...f.selection };
      if (change === 'engine') selected.engineId = 'engine-2';
      if (change === 'version' || change === 'version-aba') selected.version = 4;
      if (change === 'file') target.fileId = 'file-2';
      if (change === 'commit') target.commitId = 'commit-4';
      if (change === 'file-version') target.fileVersionNumber = 4;
      if (change === 'actor') auth = { ...auth, user: { id: 'actor-b' }, sessionRevision: 2 };
      if (change === 'permission') auth = { ...auth, permissions: { ...auth.permissions, engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }] } };
      if (change === 'tenant-url') navigation.slug = 'tenant-b';
      if (change === 'route') navigation.pathname = '/mission-control/processes/instances/another';
      if (change === 'search') navigation.search = '?process=other';
      if (change === 'view') selected.viewKey = 'instance-other';
      if (change === 'read-only') target.canEdit = false;
      if (change === 'refetch') selected.isFetching = true;
      selected.editTarget = target; f.rerender(selected); if (change === 'version-aba') f.rerender(f.selection);
    }
    await act(async () => { finish(); await pending; }); expect(navigation.go).not.toHaveBeenCalled();
  });
  it.each(['denial', 'error'])('does not show a late %s on a replacement version', async outcome => {
    let finish!: () => void; vi.mocked(apiClient.post).mockImplementation((_url, body) => new Promise((resolve, reject) => { finish = () => outcome === 'error' ? reject(new Error('old error')) : resolve({ ...allowance(body), allowed: false, reasonCode: 'denied', reason: 'old denial', missingActions: ['project.files.update'] }); }));
    const f = fixture(); let pending!: Promise<void>; act(() => { pending = f.result.current.open(); }); f.rerender({ ...f.selection, version: 4 }); await act(async () => { finish(); await pending; });
    expect(f.result.current.decision).toBeNull(); expect(f.result.current.error).toBeNull(); expect(navigation.go).not.toHaveBeenCalled();
  });
  it.each([{}, { fileId: '' }, { projectId: ' ' }, { engineId: 'other' }, { processKey: 'other' }, { processVersion: 4 }, { fileVersionNumber: 0 }, { fileVersionNumber: 1.5 }, { commitId: ' unverified ' }, { canEdit: false }, { canShowEditButton: false }])('refuses an unverified target %# without dispatch', async patch => {
    const f = fixture({ editTarget: Object.keys(patch).length ? { ...processTarget(), ...patch } : {} }); await act(async () => f.result.current.open()); expect(apiClient.post).not.toHaveBeenCalled(); expect(navigation.go).not.toHaveBeenCalled();
  });
  it('rejects a retained callback after a version replacement before dispatch', async () => {
    const f = fixture(); const old = f.result.current.open; f.rerender({ ...f.selection, version: 4 }); await act(async () => old()); expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('uses detached query metadata across settlement', async () => {
    const target = processTarget(); let finish!: () => void; vi.mocked(apiClient.post).mockImplementation((_url, body) => new Promise(resolve => { finish = () => resolve(allowance(body)); }));
    const f = fixture({ editTarget: target }); let pending!: Promise<void>; act(() => { pending = f.result.current.open(); }); target.fileId = 'foreign'; target.commitId = 'foreign'; await act(async () => { finish(); await pending; });
    expect(String(navigation.go.mock.calls[0][0])).toContain('/starbase/editor/file-1?'); expect(String(navigation.go.mock.calls[0][0])).toContain('commitId=commit-3');
  });
  it('shows a current denial while keeping navigation stopped', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (_url, body) => ({ ...allowance(body), allowed: false, reasonCode: 'denied', reason: 'Missing project edit', missingActions: ['project.files.update'] }));
    const f = fixture(); await act(async () => f.result.current.open()); expect(f.result.current.decision?.reason).toBe('Missing project edit'); expect(navigation.go).not.toHaveBeenCalled();
  });
  it('shows a current bridge error using the real client error contract', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Access unavailable'));
    const f = fixture(); await act(async () => f.result.current.open());
    expect(f.result.current.error).toBe('Access unavailable'); expect(navigation.go).not.toHaveBeenCalled();
  });
});
