import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateMissionControlStarbaseBridge, evaluateStarbaseMissionControlBridge } from '@src/shared/api/bridgeAuthz';
import { apiClient } from '@src/shared/api/client';
vi.mock('@src/shared/api/client', () => ({ apiClient: { post: vi.fn() } }));
const payload = { projectId: 'project-1', fileId: 'file-1', engineId: 'engine-1', definitionKey: 'invoice', kind: 'process' as const };
const allowed = { allowed: true, reasonCode: 'allowed', reason: 'Allowed', missingActions: [], projectId: 'project-1', fileId: 'file-1', engineId: 'engine-1', targetId: 'target-1', lineage: { kind: 'process', definitionKey: 'invoice' } };
for (const [name, evaluate, path] of [
  ['Starbase to Mission Control', evaluateStarbaseMissionControlBridge, '/api/starbase/bridge/mission-control/evaluate'],
  ['Mission Control to Starbase', evaluateMissionControlStarbaseBridge, '/api/mission-control/bridge/starbase-edit/evaluate'],
] as const) describe(name, () => {
  beforeEach(() => vi.resetAllMocks());
  it('accepts the exact structured decision without replacing server authorization', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce(allowed); expect(await evaluate(payload)).toEqual(allowed); expect(apiClient.post).toHaveBeenCalledExactlyOnceWith(path, payload);
  });
  it.each([{}, { ...allowed, allowed: 'false' }, { ...allowed, projectId: 'foreign' }, { ...allowed, fileId: 'foreign' }, { ...allowed, engineId: 'foreign' }, { ...allowed, targetId: null }, { ...allowed, reasonCode: 'denied' }, { ...allowed, missingActions: ['engine.runtime.process-definitions.read'] }, { ...allowed, lineage: { kind: 'decision', definitionKey: 'invoice' } }, { ...allowed, lineage: { kind: 'process', definitionKey: 'another-file' } }])('rejects malformed or retargeted allowance %#', async raw => {
    vi.mocked(apiClient.post).mockResolvedValueOnce(raw); await expect(evaluate(payload)).rejects.toThrow('Bridge access response was not verified');
  });
  it('accepts decision lineage with the canonical DMN alias', async () => {
    const request = { engineId: 'engine-1', projectId: 'project-1', fileId: 'file-1', kind: 'dmn' as const, decisionDefinitionId: 'decision-1', decisionDefinitionKey: 'invoice-rule' };
    const decision = { ...allowed, lineage: { kind: 'decision', decisionDefinitionId: 'decision-1', decisionDefinitionKey: 'invoice-rule' } };
    vi.mocked(apiClient.post).mockResolvedValueOnce(decision); expect(await evaluate(request)).toEqual(decision);
  });
  it('keeps a structured denial even when early resolution has no engine identity', async () => {
    const denied = { ...allowed, allowed: false, reasonCode: 'file_not_found', reason: 'Missing file', projectId: null, fileId: 'file-1', engineId: null, targetId: null, missingActions: ['project.files.read'], lineage: {} };
    vi.mocked(apiClient.post).mockResolvedValueOnce(denied); expect(await evaluate(payload)).toEqual(denied);
  });
  it('copies request identity before asynchronous settlement', async () => {
    let finish!: (value: unknown) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const mutable = { ...payload }; const pending = evaluate(mutable); mutable.fileId = 'foreign'; finish(allowed);
    expect(await pending).toEqual(allowed); expect(vi.mocked(apiClient.post).mock.calls[0][1]).toEqual(payload);
  });
});
