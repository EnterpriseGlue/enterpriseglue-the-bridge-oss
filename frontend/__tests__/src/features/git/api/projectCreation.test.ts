import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@src/shared/api/client';
import { executeProjectCreation, prepareProjectCreation, verifyProjectImportPreview } from '@src/features/git/api/projectCreation';
vi.mock('@src/shared/api/client', () => ({ apiClient: { post: vi.fn() } }));
const local = { id: 'project-1', name: 'Reviewed', ownerId: 'user-1', createdAt: 1, updatedAt: 1 };
const online = { project: { id: 'project-1', name: 'Reviewed' }, repository: { id: 'repo-1', name: 'reviewed', fullName: 'org/reviewed', private: true, url: 'https://github.com/org/reviewed', cloneUrl: 'https://github.com/org/reviewed.git' } };
const clone = { projectId: 'project-1', projectName: 'Reviewed', repositoryId: 'repo-1', filesImported: 1, foldersCreated: 0 };
const requests = { local: { name: 'Reviewed' }, online: { projectName: 'Reviewed', providerId: 'provider-1', namespace: 'org', repositoryName: 'reviewed', isPrivate: true }, clone: { projectName: 'Reviewed', providerId: 'provider-1', repoUrl: 'https://github.com/org/reviewed.git', conflictStrategy: 'preferRemote' } };
describe('project creation transport', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(['local', 'online', 'clone'] as const)('dispatches only the fixed %s route and accepts its bound canonical receipt', async kind => {
    vi.mocked(apiClient.post).mockResolvedValue({ local, online, clone }[kind]); const check = vi.fn();
    expect(await executeProjectCreation(prepareProjectCreation(kind, requests[kind]), 'user-1', check)).toEqual({ id: 'project-1', name: 'Reviewed' });
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith({ local: '/starbase-api/projects', online: '/git-api/create-online', clone: '/git-api/clone' }[kind], requests[kind]); expect(check).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { ...local, ownerId: 'foreign' }, { ...local, name: 'Foreign' }, { ...local, id: '../foreign' }, { ...local, token: 'unexpected' }])('rejects a malformed or retargeted local receipt', async raw => {
    vi.mocked(apiClient.post).mockResolvedValue(raw); await expect(executeProjectCreation(prepareProjectCreation('local', requests.local), 'user-1', () => {})).rejects.toThrow(/not verified/);
  });
  it.each([{}, { ...online, project: { ...online.project, name: 'Other' } }, { ...online, repository: { ...online.repository, fullName: 'foreign/reviewed' } }, { ...online, repository: { ...online.repository, private: false } }, { ...online, project: { ...online.project, id: 'unsafe/id' } }, { ...online, token: 'unexpected' }])('rejects a malformed or retargeted online receipt', async raw => {
    vi.mocked(apiClient.post).mockResolvedValue(raw); await expect(executeProjectCreation(prepareProjectCreation('online', requests.online), 'user-1', () => {})).rejects.toThrow(/not verified/);
  });
  it.each([{}, { ...clone, projectName: 'Foreign' }, { ...clone, repositoryId: 'bad/id' }, { ...clone, filesImported: -1 }, { ...clone, token: 'unexpected' }])('rejects an unverified clone receipt', async raw => {
    vi.mocked(apiClient.post).mockResolvedValue(raw); await expect(executeProjectCreation(prepareProjectCreation('clone', requests.clone), 'user-1', () => {})).rejects.toThrow(/not verified/);
  });
  it.each(['ssh://github.com/a/b', 'https://user:password@github.com/a/b', 'https://github.com/a/b#fragment', 'not-url'])('refuses unsafe remote URL %s before transport', url => {
    expect(() => prepareProjectCreation('clone', { ...requests.clone, repoUrl: url })).toThrow(); expect(apiClient.post).not.toHaveBeenCalled();
  });
  it.each(['token', 'url', 'ownerId'])('refuses a caller-supplied %s override', field => {
    expect(() => prepareProjectCreation('online', { ...requests.online, [field]: 'override' })).toThrow(/not verified/); expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('owns nested import input before awaiting transport and refuses a late context change', async () => {
    const input = { name: 'Reviewed', importFromEngine: { enabled: true, engineId: 'engine-1' } };
    const plan = prepareProjectCreation('local', input); input.importFromEngine.engineId = 'foreign';
    let finish!: (v: unknown) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let current = true; const execution = executeProjectCreation(plan, 'user-1', () => { if (!current) throw new Error('changed'); });
    expect(apiClient.post).toHaveBeenCalledWith('/starbase-api/projects', { name: 'Reviewed', importFromEngine: { enabled: true, engineId: 'engine-1' } });
    current = false; finish(local); await expect(execution).rejects.toThrow('changed'); expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});
const preview = { engineId: 'engine-1', allowed: true, targetAction: 'create_import_target', counts: { bpmn: 1, dmn: 0 }, files: [{ name: 'Order.bpmn', type: 'bpmn', bpmnProcessId: 'order', dmnDecisionId: null }], warnings: [] };
describe('engine preview boundary', () => {
  it('accepts metadata for the exact engine and complete counts', () => expect(verifyProjectImportPreview(preview, 'engine-1')).toEqual(preview));
  it.each([{ ...preview, engineId: 'foreign' }, { ...preview, counts: { bpmn: 2, dmn: 0 } }, { ...preview, allowed: false }, { ...preview, files: [{ ...preview.files[0], xml: '<private/>' }] }, { ...preview, token: 'private' }])('rejects foreign, incomplete or content-bearing preview', raw => expect(() => verifyProjectImportPreview(raw, 'engine-1')).toThrow(/not verified/));
});
