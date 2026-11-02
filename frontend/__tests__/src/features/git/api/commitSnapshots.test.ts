import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectCommitSnapshots, selectCommitFileSnapshot } from '@src/features/git/api/commitSnapshots';
import { apiClient } from '@src/shared/api/client';
import type { CommitFileSnapshot } from '@enterpriseglue/shared/schemas/starbase/commit-snapshot.js';

vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn() } }));
const snapshot = (overrides: Partial<CommitFileSnapshot> = {}): CommitFileSnapshot => ({
  id: 'snapshot-A', mainFileId: 'file-A', folderId: null, name: 'Old name',
  type: 'bpmn', content: '<definitions id="A"/>', changeType: 'modified', ...overrides,
});
const target = { id: 'file-A', name: 'New name', type: 'bpmn', folderId: null };

describe('project commit snapshots', () => {
  beforeEach(() => vi.resetAllMocks());
  it('uses the canonical guarded endpoint, encoding both identifiers', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ files: [snapshot()] });
    expect(await getProjectCommitSnapshots('project/a', 'commit?#')).toEqual({ files: [snapshot()] });
    expect(apiClient.get).toHaveBeenCalledWith('/vcs-api/projects/project%2Fa/commits/commit%3F%23/files');
  });
  it.each([{ files: 'invalid' }, { files: [{ id: 'partial' }] }])('rejects an incomplete response contract %j', async payload => {
    vi.mocked(apiClient.get).mockResolvedValue(payload);
    await expect(getProjectCommitSnapshots('project-A', 'commit-A')).rejects.toThrow();
  });
  it('retains stable file identity through a rename and ignores sibling names', () => {
    const own = snapshot();
    expect(selectCommitFileSnapshot([snapshot({ id: 'sibling', mainFileId: 'file-B', name: target.name }), own], target)).toBe(own);
  });
  it('never falls back to a same-name, same-type or arbitrary identified file', () => {
    expect(selectCommitFileSnapshot([snapshot({ mainFileId: 'file-B', name: target.name })], target)).toBeNull();
    expect(selectCommitFileSnapshot([snapshot({ mainFileId: 'file-B', type: 'dmn' })], target)).toBeNull();
  });
  it('accepts only a unique legacy name/type/folder match', () => {
    const legacy = snapshot({ mainFileId: null, name: target.name });
    expect(selectCommitFileSnapshot([legacy], target)).toBe(legacy);
    expect(selectCommitFileSnapshot([legacy, { ...legacy, id: 'duplicate' }], target)).toBeNull();
    expect(selectCommitFileSnapshot([legacy], { ...target, folderId: 'other-folder' })).toBeNull();
  });
  it.each([{ changeType: 'deleted' }, { changeType: 'unknown' }, { type: 'dmn' }, { content: null }, { content: '' }])('does not replace an unusable stable identity with a legacy candidate %j', overrides => {
    expect(selectCommitFileSnapshot([snapshot(overrides), snapshot({ id: 'legacy', mainFileId: null, name: target.name })], target)).toBeNull();
  });
  it('refuses ambiguous stable identity and missing target identity', () => {
    expect(selectCommitFileSnapshot([snapshot(), snapshot({ id: 'duplicate' })], target)).toBeNull();
    expect(selectCommitFileSnapshot([snapshot()], { type: 'bpmn' })).toBeNull();
  });
});
