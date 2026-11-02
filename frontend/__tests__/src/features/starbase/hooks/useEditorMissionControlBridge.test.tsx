import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@src/contexts/AuthContext';
import { apiClient } from '@src/shared/api/client';
import { useEditorMissionControlBridge } from '@src/features/starbase/hooks/useEditorMissionControlBridge';
import { getMissionControlTarget, selectLatestFileMissionControlTarget } from '@src/features/git/utils/missionControlTarget';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';

const navigation = vi.hoisted(() => ({ go: vi.fn(), slug: 'tenant-A', pathname: '/starbase/editor/file-A', search: '' }));
vi.mock('@src/shared/hooks/useTenantNavigate', () => ({ useTenantNavigate: () => ({ tenantNavigate: navigation.go, tenantSlug: navigation.slug, effectivePathname: navigation.pathname }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: navigation.pathname, search: navigation.search }) }));
vi.mock('@src/shared/api/client', async importOriginal => ({ ...await importOriginal<typeof import('@src/shared/api/client')>(), apiClient: { post: vi.fn() } }));
const file = { id: 'file-A', projectId: 'project-A', type: 'bpmn' };
const latest = (overrides: Record<string, unknown> = {}) => ({ engineId: 'engine-A', engineDeploymentId: 'deployment-A', fileId: file.id,
  fileType: 'bpmn', fileName: 'Invoice.bpmn', fileGitCommitId: 'commit-A', artifacts: [{ kind: 'process', key: 'invoice', version: 3, id: 'invoice:3:def' }],
  deployedAt: 1, engineName: 'Owned engine', environmentTag: 'staging', fileUpdatedAt: 1, fileContentHash: 'hash-A', fileGitCommitMessage: 'Saved',
  resourceName: 'Invoice.bpmn', artifactVersions: { 'process:invoice': 3 }, gitDeploymentId: null, gitCommitSha: null, gitCommitMessage: null,
  camundaDeploymentId: null, camundaDeploymentName: null, camundaDeploymentTime: null, ...overrides });
const allowance = (body: any) => ({ allowed: true, reasonCode: 'allowed', reason: 'Allowed', missingActions: [],
  projectId: body.projectId, fileId: body.fileId, engineId: body.engineId, targetId: 'target-A',
  lineage: { kind: body.kind, definitionId: body.definitionId, definitionKey: body.definitionKey,
    decisionDefinitionId: body.decisionDefinitionId, decisionDefinitionKey: body.decisionDefinitionKey } });
let auth: any;
const options = () => ({ file: { ...file }, engineId: 'engine-A', rows: [latest()], isFetching: false, canReadDeployments: true, viewKey: 'normal',
  refetch: vi.fn(async (): Promise<{ data?: unknown; isError?: boolean }> => ({ data: [latest()] })) });
function fixture(input = options()) {
  return { ...renderHook(props => useEditorMissionControlBridge(props), { initialProps: input, wrapper: ({ children }) => <AuthContext.Provider value={auth}>{children}</AuthContext.Provider> }), input };
}
beforeEach(() => { vi.resetAllMocks(); navigation.slug = 'tenant-A'; navigation.pathname = '/starbase/editor/file-A'; navigation.search = '';
  auth = { isAuthenticated: true, isLoading: false, user: { id: 'actor-A' }, sessionRevision: 1,
    permissions: { userId: 'actor-A', platform: [], projects: [], engines: [], generatedAt: 1 } };
  vi.mocked(apiClient.post).mockImplementation(async (_url, body) => allowance(body));
});

describe('exact Editor deployment target', () => {
  it('selects one exact artifact on the explicitly selected engine and detaches metadata', () => {
    const row = latest(), selected = selectLatestFileMissionControlTarget(file, [row], 'engine-A');
    expect(selected).toMatchObject({ engineId: 'engine-A', key: 'invoice', version: 3, definitionId: 'invoice:3:def' });
    row.artifacts[0].key = 'mutated'; expect(selected?.key).toBe('invoice');
    expect(selected?.identity).not.toContain('mutated');
  });
  it.each(['engine-B', '', ' engine-A '])('never falls back to another engine for %s', engine => {
    expect(selectLatestFileMissionControlTarget(file, [latest()], engine)).toBeNull();
  });
  it.each(['bpmn', 'dmn'])('shares unambiguous saved-history selection for %s', type => {
    const kind = type === 'dmn' ? 'decision' : 'process';
    const row = latest({ fileType: type, artifacts: [{ kind, key: 'invoice', version: 3, id: 'definition-A' }] });
    expect(selectLatestFileMissionControlTarget({ ...file, type }, [row], 'engine-A')?.keyParam).toBe(kind);
    expect(getMissionControlTarget(row as any, type as 'bpmn' | 'dmn')?.key).toBe('invoice');
  });
  it('rejects multiple matching rows or runtime definitions instead of choosing by rank', () => {
    const row = latest(); expect(selectLatestFileMissionControlTarget(file, [row, row], 'engine-A')).toBeNull();
    const ambiguous = latest({ artifacts: [...row.artifacts, { ...row.artifacts[0], key: 'other', version: 99 }] });
    expect(selectLatestFileMissionControlTarget(file, [ambiguous], 'engine-A')).toBeNull();
    expect(getMissionControlTarget(ambiguous as any, 'bpmn')).toBeNull();
  });
  it.each([0, -1, 3.5, '3', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid runtime version %s', version => {
    const row = latest({ artifacts: [{ kind: 'process', key: 'invoice', version, id: 'def-A' }] });
    expect(selectLatestFileMissionControlTarget(file, [row], 'engine-A')).toBeNull();
  });
  it.each([{ engineDeploymentId: '' }, { fileType: 'dmn' }, { fileId: 'foreign-file' }, { artifacts: [] },
    { artifacts: [{ kind: 'process', key: ' invoice ', version: 3, id: 'def' }] },
    { artifacts: [{ kind: 'process', key: 'invoice', version: 3, id: '' }] }, { artifacts: null }])('rejects incompatible metadata %#', patch => {
    expect(selectLatestFileMissionControlTarget(file, [latest(patch)], 'engine-A')).toBeNull();
  });
  it('accepts canonical legacy null file-type metadata when its artifact kind is exact', () => {
    expect(selectLatestFileMissionControlTarget(file, [latest({ fileType: null })], 'engine-A')?.key).toBe('invoice');
  });
  it('requires the complete latest response shape and current project/file identities', () => {
    expect(selectLatestFileMissionControlTarget(file, [{ engineId: 'engine-A', fileId: file.id }], 'engine-A')).toBeNull();
    expect(selectLatestFileMissionControlTarget({ ...file, projectId: ' ' }, [latest()], 'engine-A')).toBeNull();
    expect(selectLatestFileMissionControlTarget({ ...file, type: 'form' }, [latest()], 'engine-A')).toBeNull();
    expect(selectLatestFileMissionControlTarget(file, {}, 'engine-A')).toBeNull();
  });
});

describe('authorized Editor runtime handoff', () => {
  it('performs one fresh read and exact composite check before tenant-aware navigation', async () => {
    const f = fixture(); await act(async () => Promise.all([f.result.current.open(), f.result.current.open()]));
    expect(f.input.refetch).toHaveBeenCalledOnce(); expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/api/starbase/bridge/mission-control/evaluate', {
      projectId: 'project-A', fileId: 'file-A', engineId: 'engine-A', kind: 'process', definitionId: 'invoice:3:def', definitionKey: 'invoice' });
    expect(navigation.go).toHaveBeenCalledExactlyOnceWith('/mission-control/processes?engineId=engine-A&process=invoice&version=3');
  });
  it('preserves exact decision IDs, keys and URL encoding', async () => {
    const input = options(); input.file.type = 'dmn'; input.rows = [latest({ fileType: 'dmn', artifacts: [{ kind: 'decision', key: 'score & check', version: 4, id: 'decision:4:def' }] })];
    input.refetch.mockResolvedValue({ data: input.rows }); const f = fixture(input); await act(async () => f.result.current.open());
    expect(apiClient.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: 'decision', definitionId: 'decision:4:def', decisionDefinitionId: 'decision:4:def', definitionKey: 'score & check', decisionDefinitionKey: 'score & check' }));
    expect(navigation.go).toHaveBeenCalledWith('/mission-control/decisions?engineId=engine-A&decision=score+%26+check&version=4');
  });
  it('does not revoke its own unchanged selection when its refetch sets isFetching', async () => {
    const input = options(); let settle!: (value: any) => void; input.refetch.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    const f = fixture(input); let pending!: Promise<void>; act(() => { pending = f.result.current.open(); });
    f.rerender({ ...input, isFetching: true }); expect(apiClient.post).not.toHaveBeenCalled();
    await act(async () => { settle({ data: [latest()] }); await pending; }); expect(navigation.go).toHaveBeenCalledOnce();
  });
  it.each(['throw', 'error-with-cached-data', 'missing', 'changed'])('does not use cached authorization after fresh metadata %s', mode => {
    const input = options(); if (mode === 'throw') input.refetch.mockRejectedValue(new Error('read failed'));
    else input.refetch.mockResolvedValue(mode === 'error-with-cached-data' ? { isError: true, data: input.rows } : mode === 'missing' ? {} : { data: [latest({ engineDeploymentId: 'replacement' })] });
    return (async () => { const f = fixture(input); await act(async () => f.result.current.open()); expect(apiClient.post).not.toHaveBeenCalled(); expect(navigation.go).not.toHaveBeenCalled(); expect(f.result.current.error).toBeTruthy(); })();
  });
  it('renders a current structured denial without navigation', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (_url, body) => ({ ...allowance(body), allowed: false, reasonCode: 'missing_active_project_engine_target', reason: 'No active deployment target', missingActions: ['project.deployment-targets.read'] }));
    const f = fixture(); await act(async () => f.result.current.open()); expect(f.result.current.decision?.reason).toBe('No active deployment target'); expect(navigation.go).not.toHaveBeenCalled();
  });
  it('rejects a retargeted bridge allowance', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (_url, body) => ({ ...allowance(body), engineId: 'foreign-engine' }));
    const f = fixture(); await act(async () => f.result.current.open()); expect(navigation.go).not.toHaveBeenCalled(); expect(f.result.current.error).toContain('not verified');
  });
  it.each(['file', 'project', 'type', 'engine', 'target', 'actor', 'permission', 'tenant-route', 'path', 'search', 'view-mode', 'read-grant', 'authentication', 'loading', 'browser', 'unmount', 'away-back'])('drops pending access after %s replacement', async change => {
    let settle!: () => void; vi.mocked(apiClient.post).mockImplementation((_url, body) => new Promise(resolve => { settle = () => resolve(allowance(body)); }));
    const input = options(), f = fixture(input); let pending!: Promise<void>; act(() => { pending = f.result.current.open(); });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
    if (change === 'unmount') f.unmount();
    else if (change === 'browser') advanceBrowserSessionRevision();
    else {
      const next = { ...input, file: { ...input.file } };
      if (change === 'file') next.file.id = 'file-B';
      if (change === 'project') next.file.projectId = 'project-B';
      if (change === 'type') next.file.type = 'dmn';
      if (change === 'engine') next.engineId = 'engine-B';
      if (change === 'target' || change === 'away-back') next.rows = [latest({ engineDeploymentId: 'replacement' })];
      if (change === 'actor') auth = { ...auth, user: { id: 'actor-B' }, sessionRevision: 2 };
      if (change === 'permission') auth = { ...auth, permissions: { ...auth.permissions, projects: [{ resourceId: 'project-A', permissions: ['project:files:view'] }] } };
      if (change === 'tenant-route') navigation.slug = 'tenant-B';
      if (change === 'path') navigation.pathname = '/starbase/editor/file-B';
      if (change === 'search') navigation.search = '?other=selection';
      if (change === 'view-mode') next.viewKey = 'view';
      if (change === 'read-grant') next.canReadDeployments = false;
      if (change === 'authentication') auth = { ...auth, isAuthenticated: false };
      if (change === 'loading') auth = { ...auth, isLoading: true };
      f.rerender(next); if (change === 'away-back') f.rerender(input);
    }
    await act(async () => { settle(); await pending; }); expect(navigation.go).not.toHaveBeenCalled();
    expect(f.result.current.error).toBeNull(); expect(f.result.current.decision).toBeNull();
  });
  it('revokes an old callback before dispatch and a pending metadata read before bridge evaluation', async () => {
    const input = options(); let settle!: (value: any) => void; input.refetch.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    const f = fixture(input), old = f.result.current.open; let pending!: Promise<void>; act(() => { pending = old(); });
    f.rerender({ ...input, engineId: 'engine-B' }); await act(async () => { settle({ data: input.rows }); await pending; await old(); });
    expect(input.refetch).toHaveBeenCalledOnce(); expect(apiClient.post).not.toHaveBeenCalled(); expect(navigation.go).not.toHaveBeenCalled();
  });
  it('copies source metadata before awaits and navigates using the independently refreshed target', async () => {
    const input = options(); let settle!: (value: any) => void; input.refetch.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    const f = fixture(input); let pending!: Promise<void>; act(() => { pending = f.result.current.open(); }); input.file.id = 'mutated'; input.rows[0].artifacts[0].key = 'mutated';
    await act(async () => { settle({ data: [latest()] }); await pending; });
    expect(apiClient.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ fileId: 'file-A', definitionKey: 'invoice' }));
    expect(navigation.go).toHaveBeenCalledWith('/mission-control/processes?engineId=engine-A&process=invoice&version=3');
  });
  it.each(['missing-engine', 'no-read-grant', 'fetching', 'ambiguous'])('does not dispatch an unavailable %s selection', async mode => {
    const input = options(); if (mode === 'missing-engine') input.engineId = ''; if (mode === 'no-read-grant') input.canReadDeployments = false; if (mode === 'fetching') input.isFetching = true;
    if (mode === 'ambiguous') input.rows = [latest(), latest()];
    const f = fixture(input); await act(async () => f.result.current.open()); expect(input.refetch).not.toHaveBeenCalled(); expect(apiClient.post).not.toHaveBeenCalled();
  });
});
