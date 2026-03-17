import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { syncFileDelete } from '@enterpriseglue/shared/services/versioning/FileVcsSync.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/VcsService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/versioning/VcsService.js', () => ({
  vcsService: {
    getUserBranch: vi.fn(),
    getFiles: vi.fn(),
    deleteFile: vi.fn(),
    saveFile: vi.fn(),
  },
}));

describe('FileVcsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDataSource as unknown as Mock).mockResolvedValue({});
    (vcsService.getUserBranch as unknown as Mock).mockResolvedValue({ id: 'branch-1' });
  });

  it('deletes the matching working file by main file id', async () => {
    (vcsService.getFiles as unknown as Mock).mockResolvedValue([
      { id: 'wf-a', mainFileId: 'file-a', name: 'Invoice', type: 'bpmn', folderId: null },
      { id: 'wf-b', mainFileId: 'file-b', name: 'Invoice', type: 'bpmn', folderId: null },
    ]);

    await syncFileDelete('project-1', 'user-1', 'file-b', 'Invoice', 'bpmn', null);

    expect(vcsService.deleteFile).toHaveBeenCalledWith('wf-b');
  });
});
