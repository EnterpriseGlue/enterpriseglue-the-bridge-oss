import { describe, expect, it } from 'vitest';
import { matchesDeployedEditorBaseline, parseMissionControlEditorSelection } from '@src/features/starbase/utils/missionControlEditorSelection';

const base = '?source=mission-control&engineId=engine-A&process=invoice&version=3&commitId=commit-A&fileVersion=2';
describe('Mission Control editor source selectors', () => {
  it('retains exact process and decision selectors without inventing absent source values', () => {
    expect(parseMissionControlEditorSelection(base)).toMatchObject({ valid: true, processKey: 'invoice', version: 3, fileVersion: 2, commitId: 'commit-A' });
    expect(parseMissionControlEditorSelection('?source=mission-control&engineId=engine-A&decision=eligibility&version=4')).toMatchObject({ valid: true, processKey: '', decisionKey: 'eligibility', version: 4, commitId: null, fileVersion: null });
  });
  it.each(['1.5', '3e1', '0x10', '0', '-1', 'NaN', 'Infinity', '9007199254740992', ' 3', '03', ''])('rejects noncanonical version %s instead of changing the requested baseline', value => {
    for (const key of ['version', 'fileVersion']) {
      const params = new URLSearchParams(base); params.set(key, value);
      expect(parseMissionControlEditorSelection(params.toString())).toMatchObject({ valid: false, commitId: null, fileVersion: null, error: expect.any(String) });
    }
  });
  it.each(['source', 'process', 'decision', 'version', 'engineId', 'commitId', 'fileVersion', 'deploymentId', 'mappingSource'])('rejects duplicate %s selectors', key => {
    const params = new URLSearchParams(base); params.append(key, 'second');
    if (key === 'decision' || key === 'deploymentId' || key === 'mappingSource') params.append(key, 'third');
    expect(parseMissionControlEditorSelection(params.toString()).valid).toBe(false);
  });
  it.each(['&decision=eligibility', '&decision=', '&commitId=foreign', '&engineId=other'])('rejects ambiguous identities %s', suffix => {
    expect(parseMissionControlEditorSelection(base + suffix).valid).toBe(false);
  });
  it.each(['process', 'engineId', 'version'])('requires the original %s', key => {
    const params = new URLSearchParams(base); params.delete(key);
    expect(parseMissionControlEditorSelection(params.toString()).valid).toBe(false);
  });
  it('treats source-free editor parameters as ordinary navigation without restore selectors', () => {
    expect(parseMissionControlEditorSelection('?commitId=commit-A&fileVersion=2')).toMatchObject({ isMissionControl: false, valid: false, commitId: null, fileVersion: null });
  });
  it('enforces the canonical restore request bound before enabling source actions', () => {
    const params = new URLSearchParams(base); params.set('commitId', 'x'.repeat(201));
    expect(parseMissionControlEditorSelection(params.toString()).valid).toBe(false);
  });
  it.each(['process', 'engineId', 'commitId'])('rejects noncanonical %s identities', key => {
    const params = new URLSearchParams(base); params.set(key, ' noncanonical ');
    expect(parseMissionControlEditorSelection(params.toString()).valid).toBe(false);
  });
  it('requires every supplied baseline selector to agree', () => {
    const selected = parseMissionControlEditorSelection(base);
    expect(matchesDeployedEditorBaseline(selected, { id: 'commit-A', fileVersionNumber: 2 })).toBe(true);
    expect(matchesDeployedEditorBaseline(selected, { id: 'foreign', fileVersionNumber: 2 })).toBe(false);
    expect(matchesDeployedEditorBaseline(selected, { id: 'commit-A', fileVersionNumber: 7 })).toBe(false);
    expect(matchesDeployedEditorBaseline(selected, null)).toBe(false);
    expect(matchesDeployedEditorBaseline(parseMissionControlEditorSelection(base + '&version=4'), { id: 'commit-A', fileVersionNumber: 2 })).toBe(false);
  });
  it('supports either exact selector independently without guessing the missing one', () => {
    const params = new URLSearchParams(base); params.delete('commitId');
    expect(matchesDeployedEditorBaseline(parseMissionControlEditorSelection(params.toString()), { id: 'other', fileVersionNumber: 2 })).toBe(true);
    params.set('commitId', 'commit-A'); params.delete('fileVersion');
    expect(matchesDeployedEditorBaseline(parseMissionControlEditorSelection(params.toString()), { id: 'commit-A' })).toBe(true);
    params.delete('commitId');
    expect(matchesDeployedEditorBaseline(parseMissionControlEditorSelection(params.toString()), { id: 'commit-A' })).toBe(false);
  });
});
